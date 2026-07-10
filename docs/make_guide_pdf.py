#!/usr/bin/env python3
"""StatusPass Product Guide — branded PDF generator.
Kept in-repo so the guide can be regenerated after content changes:
    python3 docs/make_guide_pdf.py
Tokens: ink #0B0E16, card #151A28, line #262D40, text #F2F4F9, mute #8A93AB,
foil #C9A96A, teal #5B8E8B (field-tested pass color)."""
import random
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor
from reportlab.lib.units import inch
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, PageBreak, KeepTogether, Table, TableStyle,
                                NextPageTemplate)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT

INK = HexColor("#0B0E16"); CARD = HexColor("#151A28"); LINE = HexColor("#262D40")
TEXT = HexColor("#F2F4F9"); MUTE = HexColor("#8A93AB"); FOIL = HexColor("#C9A96A")
TEAL = HexColor("#5B8E8B"); TEAL_LABEL = HexColor("#DCEBEA"); GREEN = HexColor("#5FB98A")
W, H = letter; M = 0.9 * inch

def bg(canv, doc):
    canv.saveState()
    canv.setFillColor(INK); canv.rect(0, 0, W, H, fill=1, stroke=0)
    if doc.page > 1:
        canv.setFont("Courier", 7); canv.setFillColor(MUTE)
        canv.drawString(M, 0.55 * inch, "S T A T U S P A S S   —   P R O D U C T   G U I D E")
        canv.drawRightString(W - M, 0.55 * inch, f"{doc.page:02d}")
        canv.setStrokeColor(LINE); canv.setLineWidth(0.5)
        canv.line(M, 0.75 * inch, W - M, 0.75 * inch)
    canv.restoreState()

def draw_qr(canv, x, y, size):
    canv.saveState()
    canv.setFillColor(HexColor("#FFFFFF"))
    canv.roundRect(x, y, size, size, 6, fill=1, stroke=0)
    rng = random.Random(42)
    n = 17; cell = (size - 16) / n; ox, oy = x + 8, y + 8
    canv.setFillColor(HexColor("#0B0E16"))
    def finder(fx, fy):
        canv.rect(ox + fx * cell, oy + fy * cell, 5 * cell, 5 * cell, fill=0, stroke=1)
        canv.rect(ox + (fx + 1.5) * cell, oy + (fy + 1.5) * cell, 2 * cell, 2 * cell, fill=1, stroke=0)
    for i in range(n):
        for j in range(n):
            in_finder = (i < 6 and (j < 6 or j > n - 7)) or (i > n - 7 and j < 6)
            if not in_finder and rng.random() < 0.42:
                canv.rect(ox + i * cell, oy + j * cell, cell * 0.95, cell * 0.95, fill=1, stroke=0)
    finder(0.5, 0.5); finder(0.5, n - 6.5); finder(n - 6.5, 0.5)
    canv.restoreState()

def draw_pass(canv, x, y, w, h):
    canv.saveState()
    canv.setFillColor(TEAL); canv.setStrokeColor(HexColor("#4A7A77")); canv.setLineWidth(1)
    canv.roundRect(x, y, w, h, 16, fill=1, stroke=1)
    canv.setFillColor(TEXT); canv.setFont("Helvetica-Bold", 13)
    canv.drawString(x + 22, y + h - 32, "StatusPass")
    canv.setFillColor(HexColor("#2B3A5E"))
    canv.circle(x + w - 52, y + h - 78, 26, fill=1, stroke=0)
    canv.setFillColor(TEXT); canv.setFont("Helvetica-Bold", 26)
    canv.drawCentredString(x + w - 52, y + h - 87, "D")
    canv.setFillColor(TEAL_LABEL); canv.setFont("Helvetica-Bold", 8)
    canv.drawString(x + 22, y + h - 62, "CURRENT FOCUS")
    canv.setFillColor(TEXT); canv.setFont("Helvetica", 27)
    canv.drawString(x + 22, y + h - 92, "GHL / TWILIO")
    canv.setFillColor(TEAL_LABEL); canv.setFont("Helvetica-Bold", 8)
    canv.drawCentredString(x + w / 2, y + h - 122, "STATUS")
    canv.setFillColor(TEXT); canv.setFont("Helvetica", 19)
    canv.drawCentredString(x + w / 2 - 10, y + h - 143, "ON TRACK")
    canv.setStrokeColor(GREEN); canv.setLineWidth(1.2)
    canv.roundRect(x + w / 2 + 38, y + h - 146, 17, 17, 4, fill=0, stroke=1)
    canv.setFillColor(GREEN); canv.setFont("Helvetica-Bold", 13)
    canv.drawString(x + w / 2 + 42, y + h - 142, "\u2713")
    canv.setFillColor(TEAL_LABEL); canv.setFont("Helvetica-Bold", 8)
    canv.drawString(x + 22, y + h - 170, "PROGRESS")
    canv.drawString(x + w * 0.44, y + h - 170, "LAST DELIVERABLE")
    canv.setFillColor(TEXT); canv.setFont("Helvetica", 12.5)
    canv.drawString(x + 22, y + h - 186, "20% COMPLETED")
    canv.drawString(x + w * 0.44, y + h - 186, "TWILIO ACCOUNT CREATED")
    qsize = 92
    draw_qr(canv, x + (w - qsize) / 2, y + 18, qsize)
    canv.restoreState()

def cover(canv, doc):
    bg(canv, doc)
    canv.saveState()
    canv.setFont("Courier", 9); canv.setFillColor(FOIL)
    canv.drawString(M, H - 1.2 * inch, "P R O D U C T   G U I D E")
    canv.setFillColor(TEXT); canv.setFont("Helvetica-Bold", 40)
    canv.drawString(M, H - 1.8 * inch, "StatusPass")
    canv.setFont("Helvetica", 15); canv.setFillColor(MUTE)
    canv.drawString(M, H - 2.2 * inch, "Project status that lives in your stakeholder's wallet.")
    canv.drawString(M, H - 2.47 * inch, "No app. No login. No portal.")
    draw_pass(canv, M + 0.35 * inch, H - 7.0 * inch, W - 2 * M - 0.7 * inch, 4.15 * inch)
    canv.setFont("Courier", 9); canv.setFillColor(FOIL)
    canv.drawString(M, H - 7.5 * inch, ">")
    canv.setFillColor(TEXT); canv.setFont("Helvetica", 11)
    canv.drawString(M + 16, H - 7.51 * inch,
        '"GHL/Twilio integration is on track — the Twilio account is live."')
    canv.setFillColor(MUTE); canv.setFont("Helvetica", 9)
    canv.drawString(M + 16, H - 7.73 * inch, "— what lands on their lock screen, written for them, automatically")
    canv.setFont("Courier", 8); canv.setFillColor(MUTE)
    canv.drawString(M, 0.9 * inch, "STATUSPASS.AI  ·  A PROPER SELECTS PRODUCT")
    canv.drawRightString(W - M, 0.9 * inch, "FOR OPERATORS — CLIENTS NEVER NEED A GUIDE")
    canv.restoreState()

S = {
    "eyebrow": ParagraphStyle("eyebrow", fontName="Courier", fontSize=8.5, leading=12,
                              textColor=FOIL, spaceBefore=18, spaceAfter=4),
    "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=19, leading=24,
                         textColor=TEXT, spaceAfter=10),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10.5, leading=16.5,
                           textColor=HexColor("#C9CEDE"), spaceAfter=9, alignment=TA_LEFT),
    "lede": ParagraphStyle("lede", fontName="Helvetica", fontSize=12.5, leading=19,
                           textColor=TEXT, spaceAfter=12),
    "quote": ParagraphStyle("quote", fontName="Helvetica-Oblique", fontSize=10.5, leading=16,
                            textColor=MUTE, leftIndent=14, spaceAfter=9),
    "pname": ParagraphStyle("pname", fontName="Courier-Bold", fontSize=9.5, leading=13,
                            textColor=FOIL, spaceBefore=2, spaceAfter=3),
    "pbody": ParagraphStyle("pbody", fontName="Helvetica", fontSize=9.8, leading=15,
                            textColor=HexColor("#C9CEDE")),
}
def eyebrow(n, t): return Paragraph(f"{n:02d}&nbsp;&nbsp;/&nbsp;&nbsp;{t.upper().replace(' ', '&nbsp;')}", S["eyebrow"])
def h1(t): return Paragraph(t, S["h1"])
def p(t, style="body"): return Paragraph(t, S[style])
TEXT_HEX = "#F2F4F9"
def em(t): return f'<font color="{TEXT_HEX}"><b>{t}</b></font>'

def card(title, body, band="#2E3A5C"):
    tbl = Table([[Paragraph(title, S["pname"])], [Paragraph(body, S["pbody"])]],
                colWidths=[W - 2 * M - 24])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD), ("BOX", (0, 0), (-1, -1), 0.75, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, 0), 10), ("BOTTOMPADDING", (0, -1), (-1, -1), 10),
        ("TOPPADDING", (0, 1), (-1, 1), 0), ("ROUNDEDCORNERS", [8, 8, 8, 8]),
        ("LINEBEFORE", (0, 0), (0, -1), 3, HexColor(band)),
    ]))
    return KeepTogether([tbl, Spacer(1, 10)])

story = [NextPageTemplate("body"), PageBreak()]

story += [
    eyebrow(1, "What StatusPass is"),
    h1("One pass. Zero effort. Always informed."),
    p("StatusPass puts a live project status pass in your client's Apple or Google Wallet. When your "
      "project moves — a phase completes, something needs review, a milestone lands — the pass updates "
      "itself and a clean, client-safe sentence appears on their lock screen.", "lede"),
    p(f"Your client never downloads an app, never creates an account, never logs into a portal. They "
      f"tap {em('Add to Wallet')} once, and from then on the project comes to them. On the pass face: "
      f"the current focus, an at-a-glance {em('ON TRACK')} status, percent complete, the last "
      f"deliverable shipped, and a QR that opens the live demo shelf. Your side is nearly as light — "
      f"connect a board you already use, or drag a card on StatusPass's own board."),
    p("The product rests on one idea: the people you most need to keep informed — the client's CEO, "
      "the executive sponsor, the investor — will never adopt a tool. StatusPass meets them on the one "
      "surface they already carry."),

    eyebrow(2, "What it's worth to you"),
    h1("The value, in plain numbers."),
    card("KILL THE STATUS MEETING",
         "\u201CAny update?\u201D emails and weekly check-in calls exist because clients can't see. "
         "When status lives on their lock screen, agencies report the check-in cadence collapsing — "
         "hours of non-billable reassurance per client, per month, recovered.", "#C9A96A"),
    card("DEFEND EVERY INVOICE",
         "The pass is a running receipt: progress percentage climbing, deliverables logged with dates, "
         "demos on the shelf. When the invoice arrives, the client already watched the work happen. "
         "Scope and value conversations start from evidence, not memory.", "#C9A96A"),
    card("RETENTION YOU CAN FEEL",
         "Clients churn in silence, not in conflict. The quiet-period \u201Con track\u201D state, the "
         "milestone updates, the demo drops — each one is a small deposit of trust. A stakeholder who "
         "always knows where things stand has no reason to shop around.", "#C9A96A"),
    card("LOOK LIKE AN OPERATION",
         "Every update is rewritten into calm, professional language before it ships — no internal "
         "names, no blame, no invented deadlines. A one-person shop reads like a firm with an "
         "operations team. That polish is the pass, not extra work.", "#C9A96A"),

    eyebrow(3, "The five-minute start"),
    h1("Make your own phone buzz first."),
    p(f"Open your console and tap {em('Create a demo pass for yourself')}. Open the link it gives you "
      f"on your phone, add any logo, pick a color, save — then tap {em('Add to your wallet')}."),
    p(f"Now go to the {em('Board')} tab and drag your demo pass to the next phase. Add a short note "
      f"when it asks. Within seconds, your lock screen shows the update."),
    p("That's the entire product. Everything else in this guide is that loop, applied to real clients."),
]

story += [
    eyebrow(4, "Setting up a real client"),
    h1("You send one link. Setup is over."),
    p(f"Go to {em('Issue a pass')}. Type who it's for — \u201CAcme Corp — CEO\u201D — choose the type "
      f"({em('Client delivery')} for external clients, {em('Internal program')} for sponsors), and tap "
      f"{em('Create pass')}. No board connection needed."),
    p("You'll get one link. Drop it in the kickoff email you were already going to send. Your client "
      "opens it, names the project, picks their brand color, uploads their logo — and the moment they "
      "save, their pass is generated and the same page offers Add to your wallet. You did one thing: "
      "sent a link. They did one thing: opened it."),

    eyebrow(5, "Keeping the pass updated"),
    h1("Three ways to send an update. Mix them freely."),
    p(f"{em('Drag on the internal board.')} Every pass is a card in its current phase. Drag it "
      f"forward, optionally add a note, and the update ships — progress percentage recalculates "
      f"automatically. No integrations required."),
    p(f"{em('Connect Trello or Jira.')} Moving a card or transitioning an issue fires the update "
      f"without touching StatusPass at all. The Mapping tab translates your column names into the "
      f"phases your client sees; unmapped columns produce a nudge, never silence."),
    p(f"{em('Type it.')} Write it the way you'd write it for yourself — terse shorthand is fine — "
      f"because StatusPass rewrites it before it ships."),

    eyebrow(6, "Push notifications"),
    h1("How the buzz works — and what each phone shows."),
    p("Every meaningful update pushes to the stakeholder's phone through Apple's and Google's own "
      "wallet infrastructure — no app of yours, no notification permissions to beg for. The pass "
      "itself refreshes on every device it was added to: iPhone, iPad, Apple Watch, and Android."),
    p(f"{em('On iPhone,')} the lock-screen banner is your sentence, verbatim: \u201CThe homepage has "
      f"moved to review and is awaiting final copy.\u201D The guardrailed language you ship is exactly "
      f"what the CEO reads without unlocking their phone."),
    p(f"{em('On Android,')} Google Wallet shows a standard \u201Cpass updated\u201D banner, and your "
      f"sentence lives on the pass itself — one tap away. That's a Google platform behavior, true of "
      f"every wallet product; worth setting the expectation with Android-carrying clients."),
    p(f"{em('Anti-spam is built in.')} Only significant events push — phase changes, milestones, new "
      f"demos, blocked/unblocked. Subtask shuffling and comments don't. A per-pass cooldown absorbs "
      f"bursts, so dragging three cards in a minute produces one clean buzz, not three. And "
      f"stakeholders always hold the final switch: wallet passes carry a per-pass notification toggle "
      f"on the back, so a VIP can go glance-only without losing the pass."),

    eyebrow(7, "The guardrails"),
    h1("What the system will never do on your behalf."),
    p("Every update passes through the same safety layer before it reaches a client's lock screen: no "
      "team members' names, no dollar figures, no internal tool names, blocked-work language softened "
      "so nothing reads as blame — and never a date or deadline unless one actually exists on the card."),
    p("You can type:"),
    p("\u201Cstuck waiting on Dave's copy, this is dragging\u201D", "quote"),
    p("and your client's CEO sees:"),
    p("\u201CThe homepage has moved to review and is awaiting final copy.\u201D", "quote"),
    p("If an update can't be made safe, StatusPass ships a plain, true status line instead — never the "
      "leak — and tells you it did so."),

    eyebrow(8, "Quiet periods"),
    h1("Silence never looks like abandonment."),
    p("After about a week without news, the pass shows a calm \u201Con track\u201D state rather than "
      "nothing. After ten days, you get a nudge naming the client, so a real update goes out before "
      "the client wonders. Both thresholds are adjustable."),

    eyebrow(9, "The QR and the demo shelf"),
    h1("Scan the pass. See the work."),
    p("The QR on the pass face — and the link behind the pass — always opens the most relevant thing: "
      "the design preview, the item needing approval, or the demo shelf: a hosted page of sprint "
      "demos, recordings, live links, and pictures of finished work, newest first."),
    p("Paste a Loom or Zoom link the moment you record it — the stakeholder's lock screen announces "
      "the new demo. Executives who never attend the sprint demo watch the four-minute recording on "
      "their own time. The shelf accumulates across the whole engagement and never expires; at "
      "delivery it's already the complete record of everything you shipped. An empty shelf is never "
      "linked — no broken promises."),

    eyebrow(10, "Two kinds of pass"),
    h1("Same system, two vocabularies."),
    p(f"{em('Client delivery')}: the client's own logo and brand color, deliverable language, and a "
      f"status line that stays calm — ON TRACK, IN PROGRESS, or NEEDS A DECISION. Clients get phrased "
      f"status, not alarm paint."),
    p(f"{em('Internal program')}: leads with program health (green, amber, red — and the pass tints "
      f"with it), the next milestone, and when blocked, the one decision needed, with the link "
      f"pointing at the decision doc."),
]

story += [PageBreak(),
    eyebrow(11, "Who uses StatusPass"),
    h1("The same loop, seven ways."),
    p("The test is simple: is there someone important who needs to know where things stand, and who "
      "will never log into anything to find out?"),
    Spacer(1, 6),
    card("THE DEVELOPMENT AGENCY",
        "Five client projects in Trello, each decision-maker carrying a pass. Cards move, lock screens "
        "update, the QR opens the staging site. \u201CAny update?\u201D emails stop, and at invoice "
        "time the pass is a running receipt of progress the client watched happen."),
    card("THE FREELANCER",
        "No process, just work. One pass per client on the internal board; drag when something real "
        "happens. The guardrails turn shorthand into clean sentences — the pass is the professionalism "
        "layer."),
    card("THE PROGRAM MANAGER",
        "A cross-functional program in Jira, a VP sponsor who will never open it. Health at a glance, "
        "the next milestone, the one decision needed when blocked. The Friday status deck becomes a "
        "pass glanced at in the elevator."),
    card("THE FRACTIONAL EXECUTIVE",
        "Four companies, four founders, four passes. Each founder sees the current focus and next "
        "deliverable without a weekly call — quietly answering \u201Cwhat am I paying for this "
        "month?\u201D before it's asked."),
    card("THE EVENT OR WEDDING PLANNER",
        "Venue → Vendors → Details → Final Week → Event Day, with the link pointing at the current "
        "thing to approve. Anxious check-in texts drop; the phases become part of the premium "
        "experience."),
    card("THE RENOVATION LEAD",
        "Permits → Demo → Rough-In → Finishes → Punch List, progress photos behind the QR. The "
        "\u201Con track\u201D quiet state keeps trust intact through slow weeks; blocked-on-inspection "
        "reads as \u201Cawaiting county inspection\u201D — calm and blame-free."),
    card("THE PROFESSIONAL SERVICES FIRM",
        "Matter-status passes phrased safely by design — no internal names, no figures, nothing that "
        "shouldn't be on a lock screen. The client stops calling the paralegal for status: billable "
        "time recovered."),
]

story += [PageBreak(),
    eyebrow(12, "Troubleshooting"),
    h1("The five things that come up."),
    p(f"{em('The pass isn\u2019t updating.')} Check its last-updated chip in the console — small board "
      f"moves deliberately don't push; phase changes and milestones do. Send a manual update if the "
      f"board didn't capture the news."),
    p(f"{em('A board move didn\u2019t ship.')} An unmapped column is the usual cause — add it in the "
      f"Mapping tab and the next move flows."),
    p(f"{em('The update text was generic.')} The guardrail suppressed unsafe language and shipped the "
      f"plain fallback. Rephrase without names, figures, or dates and resend."),
    p(f"{em('The setup link expired.')} Issue a new one; the client's previous branding is kept."),
    p(f"{em('A VIP wants fewer notifications.')} Tighten that one pass's rule to milestones-only — or "
      f"they can flip the notification toggle on the back of the pass themselves. Every other pass is "
      f"unaffected."),

    eyebrow(13, "What StatusPass deliberately doesn't do"),
    h1("A shelf, not a portal. A pass, not a PM tool."),
    p("StatusPass doesn't manage your projects — no tasks, assignees, or checklists. Your real work "
      "stays in Trello, Jira, or your head; StatusPass only manages what your stakeholder sees. That "
      "restraint is why setup takes minutes and why your client's experience stays effortless."),
    p("If you find yourself wanting a project feature here, it belongs in your project tool — connect "
      "it instead."),
    Spacer(1, 28),
    Paragraph('<font face="Courier" size="8" color="#8A93AB">S T A T U S P A S S . A I &nbsp;&nbsp;·'
              '&nbsp;&nbsp; A &nbsp;P R O P E R &nbsp;S E L E C T S &nbsp;P R O D U C T</font>', S["body"]),
]

doc = BaseDocTemplate("/mnt/user-data/outputs/statuspass-product-guide.pdf",
                      pagesize=letter, leftMargin=M, rightMargin=M,
                      topMargin=0.95 * inch, bottomMargin=1.0 * inch,
                      title="StatusPass — Product Guide", author="Proper Selects LLC")
frame = Frame(M, 1.0 * inch, W - 2 * M, H - 1.95 * inch, id="main")
doc.addPageTemplates([PageTemplate(id="cover", frames=[frame], onPage=cover),
                      PageTemplate(id="body", frames=[frame], onPage=bg)])
doc.build(story)
print("PDF written")
