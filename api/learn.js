// Vercel serverless: extract durable personal facts about the user from their
// chat, so the app can remember them. Returns {facts:[short strings]}.
// These describe the PERSON (habits, constraints, preferences, goals, context),
// not Ayurvedic theory. No diagnosis, no medical labels.
module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { res.status(500).json({ error: "LLM not configured" }); return; }
  let body = req.body;
  try { if (typeof body === "string") body = JSON.parse(body); } catch { body = {}; }
  const profile = (body && body.profile) || {};
  const history = Array.isArray(body && body.history) ? body.history.slice(-14) : [];
  if (!history.length) { res.status(200).json({ facts: [] }); return; }
  const chat = history.map(h => `${h.role === "user" ? "User" : "Guide"}: ${String(h.content).slice(0, 400)}`).join("\n");
  const i = profile.intake || {};

  const system = `You read a conversation between a person and their Ayurvedic wellbeing guide, and pull out durable facts ABOUT THE PERSON that are worth remembering for future chats. Think of it as the guide's memory of who this person is.

Return facts that are:
- About the person: their habits, routine, work, family context they shared, food habits, what they struggle with, what they enjoy, goals, constraints, what has or hasn't worked for them.
- Stable and reusable (true next week), not one-off questions or passing remarks.
- Short, plain, written in third person about the user ("Eats dinner very late, around 10-11pm", "Wants to start exercising but struggles to begin", "Finds mornings hard").

Do NOT include: Ayurvedic theory or book facts, the guide's advice, medical diagnoses, or anything the person did not actually convey. If the person mentions sensitive health matters (mental health, medication, a child), you may note the plain fact neutrally but never a diagnosis.

Return ONLY valid JSON: {"facts":["...","..."]} with at most 8 of the most useful facts. If there is nothing durable yet, return {"facts":[]}.`;

  const user = `Known already (do not repeat these): dosha ${profile.doshaName || "?"}; wake ${i.wake || "?"}; sleep ${i.sleep || "?"}; meals ${i.meals || "?"}; exercise ${i.exercise || "?"}; stated problems ${i.problems || "?"}.\n\nCONVERSATION:\n${chat}\n\nReturn the JSON now.`;

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
                 "HTTP-Referer": "https://ayurveda-remedies-two.vercel.app", "X-Title": "Ayurveda Remedies" },
      body: JSON.stringify({ model: "minimax/minimax-m3", temperature: 0.3, max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!r.ok) { res.status(200).json({ facts: [] }); return; }
    const data = await r.json();
    let raw = data?.choices?.[0]?.message?.content?.trim() || "{}";
    const m = raw.match(/\{[\s\S]*\}/); if (m) raw = m[0];
    let p; try { p = JSON.parse(raw); } catch { p = null; }
    const facts = (p && Array.isArray(p.facts) ? p.facts : []).map(f => String(f).slice(0, 160)).filter(Boolean).slice(0, 8);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ facts });
  } catch (e) {
    res.status(200).json({ facts: [] });
  }
};
