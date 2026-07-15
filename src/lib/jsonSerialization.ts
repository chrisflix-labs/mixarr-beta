declare global {
  interface BigInt {
    toJSON?: () => string;
  }
}

/**
 * JSON has no native bigint representation. Prisma maps PostgreSQL BIGINT to
 * JavaScript BigInt, so any API that includes Track.fileSize needs a lossless
 * wire representation. Installing this once at the Prisma boundary covers all
 * server responses without converting values inside database or sync logic.
 */
export function installBigIntJsonSerialization() {
  if (typeof BigInt.prototype.toJSON === "function") return;
  Object.defineProperty(BigInt.prototype, "toJSON", {
    configurable: true,
    enumerable: false,
    writable: true,
    value(this: bigint) {
      return this.toString(10);
    },
  });
}

installBigIntJsonSerialization();
