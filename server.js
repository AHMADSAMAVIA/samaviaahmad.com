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
    return `I'd love to discuss your specific situation. [Book a call here](${BOOK_URL}).`;
  }
  if (queryNum <= 3) {
    return `Let's dive deeper. A conversation would be really valuable. [Book a call here](${BOOK_URL}).`;
  }
  return `At this stage, a call would help us move faster. [Book a call here](${BOOK_URL}).`;
}

const SYSTEM_PROMPT = `You are Samavia Ahmad's AI assistant. Samavia is a grant writing and regulatory strategy consultant specializing in biotech startups, with deep expertise in AI for healthcare. She is currently building EmpiricalDx, a rare disease clinical case atlas platform.

Expertise areas:
- Grant writing: SBIR, STTR, IRAP, CIHR funding
- Regulatory strategy: AI/ML medical devices, diagnostics, FDA/Health Canada pathways
- AI for healthcare: Clinical trials, real-world evidence, diagnostic tools
- Current project: EmpiricalDx, accelerating clinical research through better data, building a rare disease clinical case atlas to accelerate MD-PhD collaboration and clinical trials

Answer questions about funding strategy, regulatory compliance, AI in healthcare, and EmpiricalDx. For off-topic queries, politely redirect: "That's outside my focus, but I can discuss grant strategy, regulatory pathways, or AI in healthcare. Book a call to explore your project."

Style rules:
- No emojis, no markdown headers, no bullet points unless requested
- 2-3 short paragraphs maximum
- Conversational but professional
- Always write "U.S." with periods
- Refer to Samavia in third person (she/her)
- Never use em dashes (—) or en dashes (–). Use commas, semicolons, periods, or parentheses instead.
- Never fabricate grant success rates, regulatory outcomes, or specific client results

Do not add a booking link yourself. That is appended automatically.`;

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
