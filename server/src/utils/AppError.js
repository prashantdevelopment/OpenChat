class AppError extends Error {
    // field: the form field the message belongs to (sent as errors[field],
    // like a validation error), e.g. "code". reason: a short code the client
    // acts on (e.g. "rotate": make a new group key first).
    constructor(message, statusCode, { field, reason } = {}) {
        super(message);
        this.statusCode = statusCode;
        this.field = field;
        this.reason = reason;
        this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
        this.isOperational = true;  
    }
}


export default AppError;