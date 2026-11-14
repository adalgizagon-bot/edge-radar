// Workerd supports manual/follow, not redirect:error. Never follow provider redirects.
export function boundedRequestOptions(options, expiresAt) {
  const remaining = expiresAt * 1000 - Date.now();
  if (remaining <= 0) throw Error("pilot_expired");
  return {
    ...options,
    redirect: "manual",
    signal: AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      AbortSignal.timeout(remaining),
    ]),
  };
}
// Store only fixed classifications, never raw messages, URLs, headers or credentials.
export function failureDetails(error, operations) {
  const name = [
    "TimeoutError",
    "AbortError",
    "TypeError",
    "SyntaxError",
    "Error",
  ].includes(error?.name)
    ? error.name
    : "Error";
  const message = String(error?.message || "");
  let kind =
    name === "TimeoutError"
      ? "request_timeout"
      : name === "AbortError"
        ? "request_aborted"
        : name === "SyntaxError"
          ? "invalid_json"
          : "runtime_failure";
  if (message === "pilot_expired") kind = "pilot_expired";
  else if (message === "query_budget") kind = "query_budget";
  else if (/invalid_(gecko|dex)_schema/.test(message))
    kind = "invalid_provider_schema";
  else if (/D1_|SQLITE|constraint/i.test(message)) kind = "storage_failure";
  else if (/fetch|network|connect|socket|DNS/i.test(message))
    kind = "network_failure";
  let phase = operations.dex_attempted
    ? operations.dex_http_status === 200
      ? "dex_processing"
      : "dex_transport"
    : operations.discovery_attempted
      ? operations.discovery_http_status === 200
        ? "gecko_processing"
        : "gecko_transport"
      : "dispatch";
  if (kind === "storage_failure") phase = "storage";
  return { error_name: name, error_kind: kind, failure_phase: phase };
}
