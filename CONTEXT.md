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
A named container the user files Documents in. Folders can contain other Folders.
_Avoid_: directory, category, collection, tag

**Extraction**:
The AI-produced plain-English reading of one Document: its document type, translated summary, key takeaways, and critical warnings. One Extraction per Document, persisted and reused.
_Avoid_: analysis, summary, result, TL;DR

**Key Takeaway**:
A single fact directly supported by a quotation from a Document that the user needs to know (amounts, dates, obligations). A Key Takeaway has normal or critical importance.
_Avoid_: highlight, bullet

**Critical Warning**:
A Key Takeaway with critical importance that can cost the user money or rights if missed (notice periods, hidden fees, liabilities).
_Avoid_: risk, alert, red flag

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

### Deployment

**Environment**:
One of the four places an app runs: dev (framework dev servers backed by the Firebase emulators), e2e (built output served by the Hosting emulator), preview (a per-PR Hosting preview channel), and production (the live Hosting channel). Each Environment fixes each app's Peer Origin.
_Avoid_: stage, tier, mode

**Peer Origin**:
The single allowed origin of the other frame in a given Environment: the Guest's origin for the Host, the Host's origin for the Guest. The Bus's allow-list is built from it.
_Avoid_: target origin, remote origin
