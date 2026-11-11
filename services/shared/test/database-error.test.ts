import assert from "node:assert/strict";
import test from "node:test";

import { isDatabaseError } from "../src/database-error.ts";

const coded = (code: string, message = "boom") => Object.assign(new Error(message), { code });

test("a SQLSTATE from the server is a database error", () => {
  for (const code of ["40P01", "57P01", "25P02", "42P01", "08006", "XX000", "P0001", "HV00B", "22012"]) {
    assert.equal(isDatabaseError(coded(code)), true, code);
  }
});

test("a connection errno is a database error", () => {
  for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"]) {
    assert.equal(isDatabaseError(coded(code)), true, code);
  }
});

test("pg's connection failures that carry no code are database errors", () => {
  for (const message of [
    "Connection terminated unexpectedly",
    "Connection terminated",
    "Query read timeout",
    "Client has encountered a connection error and is not queryable",
    "Client was closed and is not queryable",
  ]) {
    assert.equal(isDatabaseError(new Error(message)), true, message);
  }
});

test("a five-letter Node errno is not a database error", () => {
  for (const code of ["EPERM", "EBADF", "EACCES", "EEXIST", "EISDIR"]) {
    assert.equal(isDatabaseError(coded(code)), false, code);
  }
});

test("an ordinary error or a non-error is not a database error", () => {
  assert.equal(isDatabaseError(new Error("Connection terminated unexpectedly, said the test")), false);
  assert.equal(isDatabaseError(new TypeError("x is undefined")), false);
  assert.equal(isDatabaseError(coded("ERR_INVALID_ARG_TYPE")), false);
  assert.equal(isDatabaseError("Query read timeout"), false);
  assert.equal(isDatabaseError(null), false);
});
