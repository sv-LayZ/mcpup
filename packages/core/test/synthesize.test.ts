import { describe, it, expect } from "bun:test";
import { synthesizeArgs, sampleValue } from "../src/synthesize.ts";

describe("synthesizeArgs", () => {
  it("only generates required properties", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" }, c: { type: "boolean" } },
      required: ["a", "b"],
    };
    expect(synthesizeArgs(schema)).toEqual({ a: "probe", b: 0 });
  });

  it("schema without properties / non-object → {}", () => {
    expect(synthesizeArgs({ type: "object" })).toEqual({});
    expect(synthesizeArgs("nope")).toEqual({});
    expect(synthesizeArgs(null)).toEqual({});
  });

  it("respects const > default > enum", () => {
    expect(sampleValue({ const: 42 })).toBe(42);
    expect(sampleValue({ type: "string", default: "x" })).toBe("x");
    expect(sampleValue({ type: "string", enum: ["red", "blue"] })).toBe("red");
  });

  it("scalar types", () => {
    expect(sampleValue({ type: "string" })).toBe("probe");
    expect(sampleValue({ type: "integer" })).toBe(0);
    expect(sampleValue({ type: "number", minimum: 5 })).toBe(5);
    expect(sampleValue({ type: "boolean" })).toBe(false);
    expect(sampleValue({ type: "null" })).toBe(null);
  });

  it("array: empty by default, one element if minItems > 0", () => {
    expect(sampleValue({ type: "array", items: { type: "string" } })).toEqual([]);
    expect(sampleValue({ type: "array", items: { type: "string" }, minItems: 1 })).toEqual(["probe"]);
  });

  it("type union [\"string\",\"null\"] → first type", () => {
    expect(sampleValue({ type: ["string", "null"] })).toBe("probe");
  });

  it("nested object → recurse over its required", () => {
    const schema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { id: { type: "integer" }, nick: { type: "string" } },
          required: ["id"],
        },
      },
      required: ["user"],
    };
    expect(synthesizeArgs(schema)).toEqual({ user: { id: 0 } });
  });
});
