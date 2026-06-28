// Thrown for any bad client input. The Express error handler maps it to HTTP 400
// with the message preserved, instead of a generic 500.
export class ValidationError extends Error {}
