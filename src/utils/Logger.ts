export class Logger {
    private static RESET = '\x1b[0m';
    private static FG_WHITE = '\x1b[37m';
    private static FG_GRAY = '\x1b[90m';
    private static FG_GREEN = '\x1b[32m';
    private static FG_CYAN = '\x1b[36m';
    private static FG_YELLOW = '\x1b[33m';
    private static FG_RED = '\x1b[31m';
    private static FG_MAGENTA = '\x1b[35m';

    private static format(level: string, color: string): string {
        const time = new Date().toLocaleTimeString();
        // [LEVEL] in colored LEVEL with white brackets, time in gray, then reset to default for message
        return `${Logger.FG_WHITE}[${color}${level}${Logger.FG_WHITE}] ` +
            `${Logger.FG_GRAY}${time}${Logger.RESET}`;
    }

    static info(...args: any[]) {
        console.log(
            Logger.format('INFO', Logger.FG_GREEN),
            ...args
        );
    }

    static debug(...args: any[]) {
        console.log(
            Logger.format('DEBUG', Logger.FG_CYAN),
            ...args
        );
    }

    static warn(...args: any[]) {
        console.warn(
            Logger.format('WARN', Logger.FG_YELLOW),
            ...args
        );
    }

    static error(...args: any[]) {
        console.error(
            Logger.format('ERROR', Logger.FG_RED),
            ...args
        );
    }

    static network = {
        send: (...args: any[]) => {
            console.log(
                Logger.format('SEND', Logger.FG_MAGENTA),
                JSON.stringify(args)
            );
        },
        receive: (...args: any[]) => {
            console.log(
                Logger.format('RECEIVE', Logger.FG_MAGENTA),
                ...args
            );
        }
    };
}


enum messageType {
    "receive" = "receive",
    "send" = "send"
}
