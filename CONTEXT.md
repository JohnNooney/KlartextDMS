# Klartext

A personal filing cabinet for German paperwork that explains each document in plain English. Built as two deliberately separate frontends talking across an iframe, to rehearse embedding an acquired product in a legacy dashboard.

## Language

### Applications

**Host**:
The Angular dashboard that owns sign-in, the Document library and its Folders, the PDF view of an open Document, and the frame the Guest renders in.
_Avoid_: shell, dashboard app, parent, App A

**Guest**:
The Vue insights panel rendered inside the Host's iframe that shows an open Document's Extraction and produces new Extractions.
_Avoid_: widget, child, embed, App B

### Documents

**Document**:
A file the user has uploaded together with its metadata (title, upload date). The unit the Host lists and opens.
_Avoid_: file, upload, paper

**Folder**:
A named container the user files Documents in, optionally annotated with a description and keywords. Folders can contain other Folders.
_Avoid_: directory, category, collection, tag

**Extraction**:
The AI-produced plain-English reading of one Document: its document type, translated summary, Action Items, and Key Takeaways. One Extraction per Document, persisted and reused.
_Avoid_: analysis, summary, result, TL;DR

**Action Item**:
Something in a Document the user must do, comply with when acting, or track on a calendar to avoid losing money or rights (deadlines, recurring payment or filing obligations, notice periods, strict form rules such as paper-only cancellation), directly supported by a quotation from the Document and carrying structured timing when the Document states a deadline, cadence, or notice period. Its timing's distance from today gives the item its Urgency.
_Avoid_: risk, alert, red flag, critical warning

**Urgency**:
How soon an Action Item's timing comes due, derived at read time and bucketed identically in Host and Guest: *Overdue* (a fixed deadline has passed), *This week* (a fixed deadline or the next occurrence of a monthly recurring item falls within 7 days), *Later* (further out, a recurrence too loosely specified to compute, or a notice period), or *No date*. Urgency is never stored and says nothing about importance — colour means Urgency, never the Action Item category itself.
_Avoid_: priority, severity, status

**Key Takeaway**:
A passive reference fact directly supported by a quotation from a Document that explains how the agreement or letter works (amounts, coverage limits, repair caps, settlement rules) without requiring a scheduled action or compliance step.
_Avoid_: highlight, bullet

**Reminder**:
A calendar entry the user exports from one Action Item (as an `.ics` file or a Google Calendar link) so the deadline, cadence, or notice period lands in their own calendar. Klartext does not store or track a Reminder after export.
_Avoid_: alert, notification, calendar event

**Translation**:
The full literal English rendering of one Document, page by page, produced on demand. One Translation per Document, persisted and reused. Distinct from an Extraction, which explains the Document rather than rendering all of it; a Translation is never a source for Action Items or Key Takeaways.
_Avoid_: summary, transcript, translated summary

**Extraction Job**:
One request from the Host for the Guest to produce a Document's Extraction, carrying that Document's bytes. Extraction Jobs run in the background, one at a time, independent of which Document is open.
_Avoid_: analysis, task, background job

### Cross-frame communication

**Bus**:
The `window.postMessage` channel between Host and Guest. The only way they talk.
_Avoid_: bridge, event bus, channel

**Envelope**:
The `{ v, type, sessionId, payload }` shape every Bus message takes: protocol version, message type, the Session it belongs to (empty for messages outside a Session, such as Extraction Job messages), and a payload typed per message type.
_Avoid_: message, event

**Session**:
The context the Host hands the Guest when a Document is opened: which Document, its stored Extraction or how producing one stands, and who the user is. A Session never carries the Document's bytes and never starts an Extraction. Each Session has an id the Guest echoes so the Host can discard replies to a Session it has moved past.
_Avoid_: context, init data

**Presentation**:
How the Host displays the Guest frame — the desktop insights lane or the mobile bottom sheet — told to the Guest over the Bus (`PANEL_PRESENTATION`) because the Guest can't tell them apart from its own viewport. Per-frame state, never part of a Session; the lane mode is what renders the Guest's section outline rail.
_Avoid_: layout, breakpoint

### Deployment

**Environment**:
One of the four places an app runs: dev (framework dev servers backed by the Firebase emulators), e2e (built output served by the Hosting emulator), preview (a per-PR Hosting preview channel), and production (the live Hosting channel). Each Environment fixes each app's Peer Origin.
_Avoid_: stage, tier, mode

**Peer Origin**:
The single allowed origin of the other frame in a given Environment: the Guest's origin for the Host, the Host's origin for the Guest. The Bus's allow-list is built from it.
_Avoid_: target origin, remote origin
