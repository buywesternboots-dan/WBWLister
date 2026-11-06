// Optional Gemini triage. Off unless GEMINI_API_KEY is set. A failure returns null; the report still saves.

export function geminiPrompt(priority, transcript) {
  return (
    'The user has filed an application issue triage record.\n' +
    `Current Urgency Metadata Label: ${priority}\n` +
    `User Voice-to-Text Transcription Payload: "${String(transcript ?? '').replace(/"/g, "'")}"\n` +
    'An image attachment has been linked below. The user has explicitly highlighted, outlined, or circled the technical fault surface on this canvas using a red marker tool.\n' +
    '\n' +
    'Analyze this document to evaluate the underlying technical fault. You must output a structured developer analysis breaking down:\n' +
    '1. Observed UX/UI Aberration: Detail what component is displaying incorrectly based on the area within the red circle.\n' +
    '2. Root Cause Estimation: Use the user\'s vocal description and visual error messages to identify the likely technical root cause.\n' +
    '3. Explicit Resolution Steps: Provide clean code examples, configuration tweaks, or precise database remediation scripts necessary to permanently close the issue ticket.'
  );
}

export async function analyzeBug({ priority, transcript, mimeType, data, apiKey }) {
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        { text: geminiPrompt(priority, transcript) },
        { inlineData: { mimeType, data } },
      ],
    }],
  });
  const text = response?.text;
  return typeof text === 'string' ? text.trim() : '';
}

export async function maybeAnalyze(input, env = process.env) {
  const apiKey = String(env?.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  const run = input.generate || (args => analyzeBug({ ...args, apiKey }));
  let timer;
  try {
    const text = await Promise.race([
      Promise.resolve(run(input)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), input.timeoutMs ?? 12000); }),
    ]);
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
