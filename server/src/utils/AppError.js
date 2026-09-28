class AppError extends Error {
    // field: the form field the message belongs to (sent as errors[field],
    // like a validation error), e.g. "code".
    constructor(message, statusCode, { field } = {}) {
        super(message);
        this.statusCode = statusCode;
        this.field = field;
        this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
        this.isOperational = true;  
    }
}


export default AppError;