"""Generate a one-page PDF with the App Store review demo account info."""
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

OUT = "attached_assets/store-submission/demo-accounts-for-review.pdf"

GREEN = HexColor("#2E7D5B")
DARK = HexColor("#1F2937")
GRAY = HexColor("#6B7280")
LIGHT = HexColor("#F3F7F5")

title = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=20, textColor=GREEN, spaceAfter=4)
sub = ParagraphStyle("s", fontName="Helvetica", fontSize=11, textColor=GRAY, spaceAfter=14)
h2 = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=13, textColor=DARK, spaceBefore=14, spaceAfter=6)
body = ParagraphStyle("b", fontName="Helvetica", fontSize=10.5, textColor=DARK, leading=15)

def cred_table(rows):
    t = Table(rows, colWidths=[1.6 * inch, 4.6 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Courier-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10.5),
        ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, HexColor("#D1DBD6")),
        ("BOX", (0, 0), (-1, -1), 0.75, HexColor("#B7C8BF")),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t

doc = SimpleDocTemplate(OUT, pagesize=LETTER, topMargin=0.9 * inch, bottomMargin=0.9 * inch,
                        leftMargin=0.9 * inch, rightMargin=0.9 * inch)
story = [
    Paragraph("Terra Call — Demo Accounts for App Review", title),
    Paragraph("Working credentials for Apple App Store / Google Play review. Both accounts are live and linked to each other.", sub),

    Paragraph("Caregiver demo account", h2),
    cred_table([["Email", "review.caregiver@terra-call.com"], ["Password", "AppleReview2026!Cg"]]),
    Paragraph("Sign in with this account to see the caregiver experience: the recipient dashboard, check-in status, alert history, video calling, and caregiver settings (including the new Delete Account option).", body),

    Paragraph("Care recipient demo account", h2),
    cred_table([["Email", "review.recipient@terra-call.com"], ["Password", "AppleReview2026!Cr"]]),
    Paragraph("Sign in with this account to see the care recipient experience: the large one-tap check-in button, emergency alert, and recipient settings (check-in schedule, caregiver invites, and the new Delete Account option).", body),

    Paragraph("How they are linked", h2),
    Paragraph("The recipient account has already granted access to the caregiver account, so the caregiver's dashboard shows the demo recipient immediately after login. Check-ins and alerts made on the recipient account appear on the caregiver account.", body),

    Paragraph("Notes for reviewers", h2),
    Paragraph("• No SMS or phone verification is required to sign in — email and password only.<br/>"
              "• Video calls between the two accounts require camera/microphone permission on both devices.<br/>"
              "• Account deletion is available in Settings on both account types: enter the account password, confirm, and the account and its personal data are permanently removed.", body),
    Spacer(1, 20),
    Paragraph("Prepared July 29, 2026 · Terra Call · terra-call.com", ParagraphStyle("f", fontName="Helvetica-Oblique", fontSize=9, textColor=GRAY)),
]
doc.build(story)
print("wrote", OUT)
