export class HttpError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, details);
  }
  static unauthorized(message = "No autenticado") {
    return new HttpError(401, message);
  }
  static forbidden(message = "No autorizado") {
    return new HttpError(403, message);
  }
  static notFound(message = "Recurso no encontrado") {
    return new HttpError(404, message);
  }
  static conflict(message: string, details?: unknown) {
    return new HttpError(409, message, details);
  }
}
