// Local loopback fixtures only. No market/API access, Cloudflare resources or pilot activation.
import {
  boundedRequestOptions,
  failureDetails,
} from "../../cloud-monitor/transport.mjs";
let followed = 0;
export default {
  async fetch(request) {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/ok") return Response.json({ fixture: true });
    if (path === "/redirect")
      return Response.redirect(url.origin + "/target", 302);
    if (path === "/target") {
      followed++;
      return new Response("unexpected follow");
    }
    if (path === "/slow") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return new Response("slow fixture");
    }
    const cases = [];
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const options = () =>
      boundedRequestOptions({ signal: AbortSignal.timeout(1000) }, deadline);
    const ok = await fetch(url.origin + "/ok", options());
    cases.push({
      case: "200",
      pass: ok.status === 200 && (await ok.json()).fixture === true,
    });
    const redirect = await fetch(url.origin + "/redirect", options());
    cases.push({
      case: "3xx",
      pass: redirect.status === 302 && followed === 0,
      status: redirect.status,
    });
    try {
      await fetch(
        url.origin + "/slow",
        boundedRequestOptions({ signal: AbortSignal.timeout(20) }, deadline),
      );
      cases.push({ case: "timeout", pass: false });
    } catch (error) {
      const d = failureDetails(error, {
        discovery_attempted: true,
        discovery_http_status: null,
      });
      cases.push({
        case: "timeout",
        pass: ["request_timeout", "request_aborted"].includes(d.error_kind),
        ...d,
      });
    }
    try {
      await fetch("http://127.0.0.1:18999/network-fixture", options());
      cases.push({ case: "network", pass: false });
    } catch (error) {
      cases.push({
        case: "network",
        pass: true,
        ...failureDetails(error, {
          discovery_attempted: true,
          discovery_http_status: null,
        }),
      });
    }
    return Response.json({
      ok: cases.every((x) => x.pass),
      runtime: "workerd",
      cases,
      externalMarketRequests: 0,
    });
  },
};
