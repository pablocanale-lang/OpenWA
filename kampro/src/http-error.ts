export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFound(entity: string): never {
  throw new HttpError(404, `${entity} no encontrado`);
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}
