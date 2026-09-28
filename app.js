// app.js：把事件流跑成装配台要用的视图（给定，不写）
import { record, build, parse, clear } from "./ops.js";
import { suffixOk, bandOk, flowOk, wireOk } from "./audit.js";

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function badEvent() {
  const error = new Error("E_BAD_EVENT");
  error.code = "E_BAD_EVENT";
  return error;
}

export function applyEvent(state, event) {
  if (!event || typeof event.kind !== "string") {
    throw badEvent();
  }
  if (event.kind === "add") {
    return record(state, event);
  }
  if (event.kind === "build") {
    return build(state);
  }
  if (event.kind === "parse") {
    return parse(state);
  }
  if (event.kind === "clear") {
    return clear(state);
  }
  throw badEvent();
}

export function render(spec) {
  let state = copy(spec.state);
  const steps = [];
  const stepOk = [];
  const stepKind = [];
  const events = spec.events || [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    let applied = null;
    try {
      applied = applyEvent(state, event);
    } catch (error) {
      applied = null;
    }
    stepOk.push(applied !== null);
    stepKind.push(event && typeof event.kind === "string" ? event.kind : "?");
    if (applied !== null) {
      state = applied;
    }
    steps.push(copy(state));
  }
  return {
    plan: state.plan,
    bytes: state.bytes,
    suffix: state.suffix,
    forms: state.forms,
    records: state.records,
    paths: state.paths,
    occurrences: state.occurrences,
    follows: state.follows,
    checked: state.checked,
    literal: state.literal,
    saved: state.saved,
    compressed: state.compressed,
    adds: state.adds,
    builds: state.builds,
    parses: state.parses,
    clears: state.clears,
    fails: state.fails,
    ledger: state.ledger,
    suffix_ok: suffixOk(state),
    band_ok: bandOk(state),
    flow_ok: flowOk(state),
    wire_ok: wireOk(state),
    steps: steps,
    step_ok: stepOk,
    step_kind: stepKind,
    count_events: events.length,
    failed_events: stepOk.filter(function (flag) { return !flag; }).length,
    last_form: state.forms.length > 0 ? state.forms[state.forms.length - 1] : null
  };
}
