// A clean stop and a last safety net (step 80).
//
// Every deploy (and every restart) sends SIGTERM: the server stops taking new
// connections, lets the requests in progress finish, tells every socket to go
// (the apps reconnect to the new server by themselves), closes MongoDB and
// exits. If that takes too long, it exits anyway.
//
// Errors nothing caught: a failed promise in a background task (a push, a
// clean-up) is logged and the server keeps running. A thrown exception
// nothing caught may have left the server half-way through something, so it
// is logged and the server stops cleanly with code 1: the host starts a fresh
// one at once.
export const SHUTDOWN_TIMEOUT_MS = 10_000;

// Returns shutdown(reason, code): safe to call more than once (the first wins).
export const createShutdown = ({ httpServer, io, closeDatabase, exit = (code) => process.exit(code), timeoutMs = SHUTDOWN_TIMEOUT_MS, log = console }) => {
    let stopping = null;
    return (reason, code = 0) => {
        if (stopping) return stopping;
        log.log(`${reason}: stopping the server...`);
        const force = setTimeout(() => {
            log.error(`Stopping took over ${timeoutMs} ms: exiting now`);
            exit(1);
        }, timeoutMs);
        force.unref?.();
        stopping = (async () => {
            let exitCode = code;
            try {
                // io.close() disconnects every socket, then closes the HTTP
                // server: no new connections, and it waits for open requests.
                await new Promise((resolve) => {
                    io.close(() => resolve());
                    httpServer.closeIdleConnections?.(); // idle keep-alive connections don't hold it open
                });
                await closeDatabase();
            } catch (error) {
                log.error("Error while stopping:", error);
                exitCode = exitCode || 1;
            }
            clearTimeout(force);
            exit(exitCode);
        })();
        return stopping;
    };
};

// on: process.on (tests pass their own).
export const handleProcessErrors = ({ shutdown, log = console, on = process.on.bind(process) }) => {
    on("unhandledRejection", (reason) => log.error("Unhandled promise rejection (the server keeps running):", reason));
    on("uncaughtException", (error) => {
        log.error("Uncaught exception, restarting:", error);
        shutdown("uncaughtException", 1);
    });
    on("SIGTERM", () => shutdown("SIGTERM"));
    on("SIGINT", () => shutdown("SIGINT"));
};
