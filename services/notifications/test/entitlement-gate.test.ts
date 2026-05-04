import test from "node:test";
import assert from "node:assert/strict";
import {
  filterFactsForChannel,
  notificationChannelEgresses,
  NotificationEntitlementError,
} from "../src/entitlement-gate.ts";

const appOnlyFact = Object.freeze({
  fact_id: "11111111-1111-4111-8111-111111111111",
  entitlement_channels: Object.freeze(["app"]),
});

const emailFact = Object.freeze({
  fact_id: "22222222-2222-4222-8222-222222222222",
  entitlement_channels: Object.freeze(["app", "email", "push"]),
});

test("notificationChannelEgresses treats app/in_app as non-egress and email/push/sms/digest as egress", () => {
  assert.equal(notificationChannelEgresses("in_app"), false);
  assert.equal(notificationChannelEgresses("app"), false);
  assert.equal(notificationChannelEgresses("email"), true);
  assert.equal(notificationChannelEgresses("web_push"), true);
  assert.equal(notificationChannelEgresses("mobile_push"), true);
  assert.equal(notificationChannelEgresses("sms"), true);
  assert.equal(notificationChannelEgresses("digest"), true);
});

test("filterFactsForChannel blocks app-only facts from email egress", () => {
  assert.throws(
    () => filterFactsForChannel([appOnlyFact], "email"),
    (error) =>
      error instanceof NotificationEntitlementError &&
      error.blocked_fact_ids.includes(appOnlyFact.fact_id) &&
      /email/.test(error.message),
  );
});

test("filterFactsForChannel allows facts explicitly entitled for the channel", () => {
  assert.deepEqual(filterFactsForChannel([emailFact], "email"), [emailFact]);
  assert.deepEqual(filterFactsForChannel([emailFact], "web_push"), [emailFact]);
});

test("filterFactsForChannel allows app-only facts for in-app rendering", () => {
  assert.deepEqual(filterFactsForChannel([appOnlyFact], "in_app"), [appOnlyFact]);
});
