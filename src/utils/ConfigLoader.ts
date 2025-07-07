import {Config} from "../interface/Config";
import path from "path";
import * as fs from "node:fs";
import {Clients} from "../interface/Clients";
import {Logger} from "./Logger";
import * as yaml from 'yaml';

export class ConfigManager {
    static defaultClients: Clients = {
        clients: [
            {
                'client_type': 'onebot',
                'client_id': 'survival',
                'client_token': '',
                'client_name': '生存服'
            }
        ]
    };

    static defaultConfig = {}


    private static serverConfig: Config | undefined;
    private static clientsList: Clients | undefined;

    static getServerConfig(): Config {
        if (this.serverConfig) return this.serverConfig;
        /** 如果配置文件和接口不匹配，需要补齐默认的值并且输出回相关的配置文件 */
        const configPath = path.resolve(process.cwd(), 'clients.yaml');
        const fileContent = fs.readFileSync(configPath, 'utf8');
        this.serverConfig = yaml.parse(fileContent) as typeof ConfigManager.defaultClients;
        return this.serverConfig;
    }

    static getClientsList(): Clients {
        if (this.clientsList !== undefined) return this.clientsList;
        const configPath = path.resolve(process.cwd(), 'clients.yaml');
        const fileContent = fs.readFileSync(configPath, 'utf8');
        const clientsConfig = yaml.parse(fileContent);
        Logger.debug("客户端列表已加载", clientsConfig);
        return clientsConfig as Clients;
    }
}