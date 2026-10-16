export class KmzContainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KmzContainerError';
  }
}
