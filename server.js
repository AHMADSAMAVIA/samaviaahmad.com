require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_QUERIES_PER_IP = 5;
const MODEL = 'claude-sonnet-4-6';
const BOOK_URL = 'https://calendly.com/ahmadsamavia/30min';

function bookingTail(queryNum) {
  if (queryNum <= 1) {
    return `I'd love to discuss your specific situation—[book a call here](${BOOK_URL}).`;
  }
  if (queryNum <= 3) {
    return `Let's dive deeper into your project. I think a conversation would be really valuable—[book a call here](${BOOK_URL}).`;
  }
  return `At this stage, a call would help us move faster—[book a call here](${BOOK_URL}).`;
}

const SYSTEM_PROMPT = `You are a helpful assistant on Samavia Ahmad's consulting website. Samavia is a translational health sciences consultant and biotech founder based in Windsor, Ontario. She has an MSc in Translational Health Sciences and a BSc in Biomedical Science and Biochemistry. She founded Setpoint Bio, a liquid biopsy diagnostics startup developing a ctRNA-based multi-cancer early detection test.

She helps early-stage biotech startups in the U.S. and Canada with:
1. Grant writing — NIH SBIR Phase I & II, NCI, IRAP, CIHR
2. Regulatory strategy — LDT pathway, FDA De Novo/510(k), Health Canada IVD
3. Translational research consulting — study design, assay development, CRO selection, biomarker discovery

Answer questions about these topics clearly and specifically. Speak in a knowledgeable, direct tone — not overly formal. You can reference Samavia's background to establish credibility where relevant.

After the user's first or second message, naturally suggest: "If you'd like to go deeper on your specific project, Samavia offers 30-minute intro calls — you can book directly at https://calendly.com/ahmadsamavia/30min"

If asked about topics outside grant writing, regulatory strategy, or translational research consulting, respond: "That's a bit outside my lane, but Samavia would be happy to point you in the right direction. Book a quick call at https://calendly.com/ahmadsamavia/30min"

Never fabricate grant success rates, regulatory outcomes, or specific client results. Keep responses concise and practical.`;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ipUsage = new Map();

app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

app.post('/api/chat', async (req, res) => {
  const ip = getClientIp(req);
  const message = (req.body && req.body.message ? String(req.body.message) : '').trim();

  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const used = ipUsage.get(ip) || 0;
  if (used >= MAX_QUERIES_PER_IP) {
    return res.status(429).json({
      error:
        "You've reached the 5-question limit for this session. Book a call to continue the conversation.",
      queriesUsed: used,
    });
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
    });

    let reply = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    const newCount = used + 1;
    ipUsage.set(ip, newCount);

    reply += `\n\n${bookingTail(newCount)}`;

    return res.json({ reply, queriesUsed: newCount, queriesRemaining: MAX_QUERIES_PER_IP - newCount });
  } catch (err) {
    console.error('Anthropic API error:', err);
    return res.status(500).json({ error: 'Failed to generate a response. Please try again.' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
