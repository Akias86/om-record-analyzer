export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/om/")) {
      const apiUrl = new URL(url.pathname.slice(4) + url.search, env.LEADERBOARD_API)
      return fetch(apiUrl, {
        headers: request.headers,
        body: request.body,
      })
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
