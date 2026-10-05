const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const readline = require('node:readline');
const {once} = require('node:events');
const WebSocket = require('ws');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {Platform} = require('../../server/dist/core/Platform');
const {IdentityStore} = require('../../server/dist/storage/IdentityStore');
const {ChatHubServer} = require('../../server/dist/server');

test('actual Python plugin registers, delivers chat and reports MC events as a virtual system user', {timeout: 15000}, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chathub-image-node-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const platform = new Platform(new IdentityStore());
    const server = new ChatHubServer({host: '127.0.0.1', port: 0, node_password: 'nodes', onebot_token: 'apps',
        dashboard_token: 'admin', settings_file: path.join(directory, 'settings.json'), image_directory: path.join(directory, 'images'),
        identity_file: '', delivery_timeout_ms: 3000, onebot_reverse_urls: [], relay: {enabled: false, nodes: []}}, platform);
    const port = await server.start();
    t.after(() => server.stop());
    const python = spawn(process.env.PYTHON ?? 'python3', ['tests/integration/native_node.py',
        `ws://127.0.0.1:${port}/chathub/v2/connect`], {stdio: ['pipe', 'pipe', 'pipe'], env: process.env});
    let errors = '';
    python.stderr.on('data', data => {errors += data.toString();});
    const lines = [];
    const lineReader = readline.createInterface({input: python.stdout});
    lineReader.on('line', raw => lines.push(JSON.parse(raw)));
    t.after(async () => {
        python.stdin.end(JSON.stringify({type: 'stop'}) + '\n');
        if (python.exitCode === null) {
            const timer = setTimeout(() => python.kill('SIGKILL'), 4000);
            await once(python, 'exit'); clearTimeout(timer);
        }
        lineReader.close();
    });
    const waitFor = async predicate => {
        const deadline = Date.now() + 6000;
        while (!predicate()) {
            if (python.exitCode !== null) throw new Error(`Python failed: ${errors}`);
            if (Date.now() > deadline) throw new Error(`Live node timeout: ${errors}; ${JSON.stringify(lines)}`);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };
    await waitFor(() => platform.groups().length === 1 && [...platform.groups()[0].members.values()].length === 1 &&
        lines.some(line => line.type === 'ready'));
    const app = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11`, {headers: {Authorization: 'Bearer apps'}});
    const frames = [];
    app.on('message', raw => frames.push(JSON.parse(raw)));
    await once(app, 'open');
    python.stdin.write(JSON.stringify({type: 'chat', text: 'hello from Python'}) + '\n');
    await waitFor(() => frames.some(frame => frame.post_type === 'message'));
    const event = frames.find(frame => frame.post_type === 'message');
    assert.equal(event.sender.nickname, 'Steve');
    assert.deepEqual(event.message, [{type: 'text', data: {text: 'hello from Python'}}]);
    assert.ok(Number.isInteger(event.user_id));
    app.send(JSON.stringify({action: 'send_group_msg', params: {group_id: event.group_id, message: 'hello from OneBot'}, echo: 'python'}));
    await waitFor(() => frames.some(frame => frame.echo === 'python') && lines.some(line => line.command?.startsWith('tellraw @a ')));
    assert.equal(frames.find(frame => frame.echo === 'python').status, 'ok');
    const command = lines.find(line => line.command?.startsWith('tellraw @a ')).command;
    assert.equal(JSON.parse(command.slice('tellraw @a '.length)).at(-1).text, 'hello from OneBot');
    assert.equal(frames.filter(frame => frame.post_type === 'message').length, 1);
    // Real OneBot WS -> native delivery -> Python renderer, with default config.
    const imageUrl = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=abc&rkey=a-b_c%2F%3D';
    const gifUrl = 'https://example.org/animation.gif';
    for (const [echo, message, expected] of [
        ['images', [
            {type: 'text', data: {text: '前文'}},
            {type: 'image', data: {file: 'bot-local-file.jpg', url: imageUrl}},
            {type: 'text', data: {text: '中间'}},
            {type: 'image', data: {file: gifUrl}},
            {type: 'text', data: {text: '后文'}},
        ], `前文[[CICode,url=${imageUrl},name=图片]]中间[[CICode,url=${gifUrl},name=图片]]后文`],
        ['cq-image', `[CQ:image,file=${imageUrl.replaceAll('&', '&amp;')}]`, `[[CICode,url=${imageUrl},name=图片]]`],
    ]) {
        const start = lines.length;
        app.send(JSON.stringify({action: 'send_group_msg', params: {group_id: event.group_id, message}, echo}));
        await waitFor(() => frames.some(frame => frame.echo === echo) &&
            lines.slice(start).some(line => line.command?.startsWith('tellraw @a ')));
        assert.equal(frames.find(frame => frame.echo === echo).status, 'ok');
        const imageCommand = lines.slice(start).find(line => line.command?.startsWith('tellraw @a ')).command;
        const parts = JSON.parse(imageCommand.slice('tellraw @a '.length));
        assert.equal(parts.slice(2).map(part => part.text).join(''), expected);
        const images = parts.filter(part => part.clickEvent?.action === 'open_url');
        assert.deepEqual(images.map(part => part.clickEvent.value), echo === 'images' ? [imageUrl, gifUrl] : [imageUrl]);
    }
    // Uploaded base64 -> public URL -> real native/Python renderer -> ChatImage CICode.
    const origin = `http://127.0.0.1:${port}`;
    const headers = {Authorization: 'Bearer admin', 'Content-Type': 'application/json'};
    const {settings} = await (await fetch(origin + '/api/settings', {headers})).json();
    const saved = await fetch(origin + '/api/settings', {method: 'PUT', headers,
        body: JSON.stringify({...settings, public_url: origin})});
    assert.equal(saved.status, 200);
    const png = await sharp({create: {width: 2, height: 2, channels: 3, background: 'blue'}}).png().toBuffer();
    const imageStart = lines.length;
    app.send(JSON.stringify({action: 'send_group_msg', echo: 'uploaded-image', params: {group_id: event.group_id,
        message: [{type: 'image', data: {file: 'base64://' + png.toString('base64')}}]}}));
    await waitFor(() => frames.some(frame => frame.echo === 'uploaded-image') &&
        lines.slice(imageStart).some(line => line.command?.startsWith('tellraw @a ')));
    assert.equal(frames.find(frame => frame.echo === 'uploaded-image').status, 'ok');
    const imageCommand = lines.slice(imageStart).find(line => line.command?.startsWith('tellraw @a ')).command;
    const uploadedImage = JSON.parse(imageCommand.slice('tellraw @a '.length)).find(part => part.clickEvent?.action === 'open_url');
    const downloadUrl = uploadedImage.clickEvent.value;
    assert.match(downloadUrl, /\/media\/images\/[0-9a-f]{64}\.png$/);
    assert.equal(uploadedImage.text, `[[CICode,url=${downloadUrl},name=图片]]`);
    assert.equal(imageCommand.includes('base64://'), false);
    const download = await fetch(downloadUrl);
    assert.equal(download.status, 200);
    const pixels = await sharp(Buffer.from(await download.arrayBuffer())).raw().toBuffer();
    assert.deepEqual(pixels, await sharp(png).raw().toBuffer());
    for (const value of [
        {type: 'startup'},
        {type: 'leave'},
        {type: 'join'},
        {type: 'log', text: 'Steve has made the advancement [Stone Age]'},
        {type: 'log', text: 'Steve was slain by Zombie'},
        {type: 'shutdown'},
    ]) python.stdin.write(JSON.stringify(value) + '\n');
    await waitFor(() => frames.filter(frame => frame.post_type === 'message' && frame.user_id === 2).length === 6);
    const announcements = frames.filter(frame => frame.post_type === 'message' && frame.user_id === 2);
    assert.deepEqual(announcements.map(frame => frame.message[0].data.text), [
        '服务器已启动', 'Steve 离开了服务器', 'Steve 加入了服务器',
        'Steve has made the advancement [Stone Age]', 'Steve was slain by Zombie', '服务器已关闭',
    ]);
    assert.ok(announcements.every(frame => frame.self_id === 1 && frame.sender.nickname === 'Minecraft Server'));
    assert.ok(announcements.every(frame => frame.group_id === event.group_id));
    // Shutdown notification alone does not drive presence: the next server API call does.
    await waitFor(() => platform.groups().length === 1 &&
        [...platform.groups()[0].members.values()].every(member => !member.online));
    assert.equal(platform.groups()[0].members.size, 1); // retain the observed offline member
    app.close();
});
