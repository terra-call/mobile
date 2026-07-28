#!/usr/bin/env python3
"""Generate the Terra Call feature summary PDF."""
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, HRFlowable,
)

DARK = colors.HexColor("#0d1b2a")
GREEN = colors.HexColor("#1f8a4c")
BLUE = colors.HexColor("#1b6ec2")
GRAY = colors.HexColor("#5a6a7a")

styles = getSampleStyleSheet()
title = ParagraphStyle("TitleX", parent=styles["Title"], textColor=DARK, fontSize=24, spaceAfter=4)
subtitle = ParagraphStyle("Sub", parent=styles["Normal"], textColor=GRAY, fontSize=11, spaceAfter=14)
h1 = ParagraphStyle("H1x", parent=styles["Heading1"], textColor=GREEN, fontSize=15, spaceBefore=16, spaceAfter=6)
h2 = ParagraphStyle("H2x", parent=styles["Heading2"], textColor=BLUE, fontSize=12, spaceBefore=10, spaceAfter=4)
body = ParagraphStyle("BodyX", parent=styles["Normal"], fontSize=10, leading=14, spaceAfter=4)
bullet = ParagraphStyle("BulletX", parent=body, leftIndent=0)

def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(i, bullet), leftIndent=14) for i in items],
        bulletType="bullet", start="•", bulletFontSize=8, leftIndent=10, spaceAfter=6,
    )

doc = SimpleDocTemplate(
    "attached_assets/terra-call-feature-summary.pdf", pagesize=letter,
    leftMargin=0.9 * inch, rightMargin=0.9 * inch, topMargin=0.8 * inch, bottomMargin=0.8 * inch,
    title="Terra Call — Feature Summary",
)

E = []
E.append(Paragraph("Terra Call", title))
E.append(Paragraph("Emergency Caregiver Monitoring — Complete Feature Summary (July 2026)", subtitle))
E.append(HRFlowable(width="100%", thickness=1, color=GREEN))

E.append(Paragraph("Logging In &amp; Accounts", h1))
E.append(bullets([
    "<b>Sign up / sign in</b> with email and password (Firebase Authentication).",
    "During registration you pick a role: <b>Care Recipient</b>, <b>Caregiver</b>, or <b>Family Member</b>.",
    "<b>Admin access:</b> admin is not a role you can pick at signup. The account <b>mike@terra-call.com</b> is automatically given the admin role when it signs in. To use the admin dashboard, log in with that email and its password.",
    "Once inside, an admin can promote or change any other user's role from the <b>Users</b> tab of the admin dashboard.",
]))

E.append(Paragraph("Care Recipient Features", h1))
E.append(bullets([
    "<b>\u201cI'M OK\u201d check-in button</b> — one big tap to record they're safe; recent check-in history shown below.",
    "<b>\u201cI'M NOT OK\u201d emergency button</b> — instantly alerts all linked caregivers (push notification, and SMS if the recipient consented).",
    "<b>Call My Caregiver</b> — starts a video call to their caregiver, with a real in-app ringtone on the caregiver's side.",
    "<b>Emergency options</b> — quick access to call 911 or their caregiver directly.",
    "<b>Home camera settings</b> — optionally connect a Reolink home camera (credentials stored encrypted).",
    "<b>Location privacy</b> — location is captured only at check-in or emergency, never continuously tracked.",
    "<b>Missed check-in reminders</b> — local reminders on their device, with configurable time windows.",
]))

E.append(Paragraph("Caregiver Features", h1))
E.append(bullets([
    "<b>Live status dashboard</b> — all linked recipients at a glance: Safe, Missed, or Emergency, updated in real time.",
    "<b>Alert feed</b> — recent alerts (missed check-ins, emergencies) with a per-caregiver \u201cclear\u201d that doesn't affect other caregivers.",
    "<b>Automatic emergency camera</b> — when a recipient triggers an emergency, a full-screen modal pops up on the caregiver's phone with the home camera feed, or a clean prompt to start a phone video call if no home camera is set up.",
    "<b>Two-way video calls</b> — call a recipient's phone camera; during emergencies the screen splits to show both the phone camera and the home camera feeds.",
    "<b>Map view</b> — recipient locations from their last check-in or emergency (with a list fallback where maps aren't available).",
    "<b>Invite system</b> — link new care recipients via invite codes (sent by email/SMS).",
    "<b>Push + SMS alerts</b> — notified when a recipient misses their check-in window or escalates to an emergency; SMS is gated by the recipient's consent (HIPAA).",
]))

E.append(Paragraph("Admin Dashboard", h1))
E.append(Paragraph("Log in as <b>mike@terra-call.com</b> to access the admin dashboard.", body))
E.append(bullets([
    "<b>Overview tab</b> — user metrics (totals, active, signups), activity stats (check-ins, emergencies), and system health (API, Firebase, Twilio delivery rates).",
    "<b>Users tab</b> — search and filter all users, change roles, link users to organizations, and track HIPAA consent status.",
    "<b>Organizations tab</b> — B2B account management for home health agencies and Medicaid providers, including subscription tier and status.",
    "<b>Care Reports tab</b> — generate care activity reports for a user and date range; export as CSV or PDF.",
    "<b>Audit Log tab</b> — append-only, HIPAA-compliant trail of logins, check-ins, data access, and admin edits.",
]))

E.append(Paragraph("Under the Hood", h1))
E.append(bullets([
    "Firebase Auth + Firestore for real-time data; Twilio for video calls and SMS; an Express API server for tokens, notifications, and the camera proxy.",
    "PHI hygiene throughout: no recipient names in push notification text, encrypted camera credentials, names in SMS only with consent.",
    "Ships as a native Android/iOS build with over-the-air updates for JavaScript-only changes.",
]))

doc.build(E)
print("done")
