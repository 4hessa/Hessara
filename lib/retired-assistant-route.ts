const RETIRED = Object.freeze({
  error: "FEATURE_REMOVED",
  feature: "HESSARA_ASSISTANT",
  message: "This built-in assistant has been removed. Other model and agent workspaces are available in HESSARA.",
});

/** Keep stale clients safe and explicit without authenticating, reading bodies, or touching storage. */
export function retiredAssistantRoute() {
  return Response.json(RETIRED, {
    status: 410,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
