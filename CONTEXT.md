# Klartext

A personal filing cabinet for German paperwork that explains each document in plain English. Built as two deliberately separate frontends talking across an iframe, to rehearse embedding an acquired product in a legacy dashboard.

## Language

### Applications

**Host**:
The Angular dashboard that owns sign-in, the document list, and the frame the Guest renders in.
_Avoid_: shell, dashboard app, parent, App A

**Guest**:
The Vue widget rendered inside the Host's iframe that shows a Document and its Extraction.
_Avoid_: widget, child, embed, App B

### Documents

**Document**:
A file the user has uploaded together with its metadata (title, type, upload date). The unit the Host lists and the Guest opens.
_Avoid_: file, upload, paper

**Extraction**:
The AI-produced plain-English reading of one Document: its document type, translated summary, key takeaways, and critical warnings. One Extraction per Document, persisted and reused.
_Avoid_: analysis, summary, result, TL;DR

**Key Takeaway**:
A single fact directly supported by a quotation from a Document that the user needs to know (amounts, dates, obligations). A Key Takeaway has normal or critical importance.
_Avoid_: highlight, bullet

**Critical Warning**:
A Key Takeaway with critical importance that can cost the user money or rights if missed (notice periods, hidden fees, liabilities).
_Avoid_: risk, alert, red flag

### Cross-frame communication

**Bus**:
The `window.postMessage` channel between Host and Guest. The only way they talk.
_Avoid_: bridge, event bus, channel

**Envelope**:
The `{ v, type, sessionId, payload }` shape every Bus message takes: protocol version, message type, the Session it belongs to, and a payload typed per message type.
_Avoid_: message, event

**Session**:
The context the Host hands the Guest when a Document is opened: which Document (including its bytes), any stored Extraction, and who the user is. Each Session has an id the Guest echoes so the Host can discard replies to a Session it has moved past.
_Avoid_: context, init data
