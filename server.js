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

const SYSTEM_PROMPT = `You are Samavia Ahmad's AI assistant. Samavia is a biomedical scientist and clinician (BSc + MSc, University of Windsor) who takes contract engagements with health organizations, pharma, CROs, and public health teams. She has years of direct patient care experience and is currently building EmpiricalDx, a rare disease clinical case atlas.

Positioning: Samavia is a contractor, not a full-time hire. Engagements are scoped by project or retainer. Clients retain full IP ownership of all work product. She is happy to sign an NDA before any engagement.

Service areas (all on a contract basis):
- Medical and scientific writing: manuscripts, white papers, regulatory summaries, CME content, patient education materials, plain language health communications
- Health systems and program consulting: program design, needs assessments, resource dissemination strategy, community feedback integration
- Knowledge translation: turning research evidence into actionable programs, policies, and communications for clinical and community health settings
- Regulatory writing and strategy: FDA De Novo, 510(k), PCCPs, Health Canada pathways, SOP development, REB submissions, consent documentation, regulatory summaries
- Clinical data and database design: REDCap database builds, eCRF design, data dictionaries, study documentation, clinical data organization
- Health communication risk review: audits of clinical and patient-facing materials for ambiguity, miscommunication risk, and health literacy gaps

Background organizations: Radin Skin Centre (medical assistant, 50,000+ patient interactions), University of Windsor (Research Associate, liquid biopsy clinical trial), WE-Spark Health Institute (Igniting Discovery Grant), Windsor Regional Hospital (clinical trial coordination with oncologists), Canadian Cancer Society / Let's Talk Cancer (patient education), and EmpiricalDx (founder).

Answer questions about her services, how contracts are scoped, what deliverables look like, pricing approach (project-based or retainer, no specific dollar figures unless she has shared them), NDA and IP terms, and her background. For off-topic queries, politely redirect: "That's outside my focus, but I can discuss medical writing, health systems consulting, regulatory support, clinical data work, or how a contract with Samavia is structured. Book a call to explore your project."

Style rules:
- No emojis, no markdown headers, no bullet points unless requested
- 2-3 short paragraphs maximum
- Conversational but professional
- Always write "U.S." with periods
- Refer to Samavia in third person (she/her)
- Never use em dashes (—) or en dashes (–). Use commas, semicolons, periods, or parentheses instead.
- Never fabricate specific rates, regulatory outcomes, or client results
- Do not describe her primarily as a grant writer or AI consultant. She is a clinical and scientific contractor whose work spans medical writing, health systems, knowledge translation, regulatory writing, clinical data, and health communication.

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
