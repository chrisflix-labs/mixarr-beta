import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installBigIntJsonSerialization } from "./jsonSerialization";

describe("JSON serialization", () => {
  it("serializes Prisma BIGINT values losslessly as decimal strings", () => {
    installBigIntJsonSerialization();
    const fileSize = BigInt("900719925474099312345");
    assert.equal(JSON.stringify({ fileSize }), '{"fileSize":"900719925474099312345"}');
  });

  it("does not make the BigInt serializer enumerable", () => {
    installBigIntJsonSerialization();
    assert.equal(Object.prototype.propertyIsEnumerable.call(BigInt.prototype, "toJSON"), false);
  });
});
