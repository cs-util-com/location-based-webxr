# Observations Task 1:
-webapp couldn’t tell apart two nearby points easily, resulting in imprecise observations
-webapp used old markers from previous walks and counted them on to the next walk
(even after deleting old walks)
-3d spheres of markers often didn’t exactly align, but where close enough to be in the “same spot”
-occasionally would stop working or mark multiple points

# Fragen nach Task 1:
- Welche "Apps" sind gemeint in Task1.3?
- Warum haben wir 10-13 marks bei unseren walks gesammelt, obwohl wir nur wenige gesetzt haben?
- Warum schweben überall grüne? Punkte in der Luft herum?
- Warum sehen wir kein feedback über unsere observations (ob man die observation gemacht hat)?
- how can we extract and look at the saved kml file? google earth webapp only allows to download as kml file not kmz, saving in google earth pro desktop app allows to save as kmz but not as a extractable zip with doc.kml or xml elements

# Fragen nach Implementierung von Komponente 1:
- Was ist mit b2b tests gemeint? -> Unseren Kml Viewer im Kontext von der gesamten Anwendung testen.
- Müssen wir für jede Komponente mehrere Implementierungen erstellen und daraus die beste auswählen? -> Nein, nur für komplexe Komponenten (in unserem Fall der Store).

# Notizen/Gedanken zu components:
- store:
Es ist auch möglich redux-undo wie zuvor zu benutzen, die automatisch State-Snapshots speichern. In unserem Fall macht die eigene Command-Historie aber aus zwei Gründen mehr Sinn:

XML-Referenz-Problem: redux-undo speichert flache Kopien des Redux-States. Da das KML-Dokument (IKmlDocument) jedoch eine komplexe, veränderliche XML-Baumstruktur ist, würden alle alten Snapshots in der History auf dasselbe, bereits veränderte Dokument zeigen.
Performance (keine Riesen-Snapshots): Um das mit redux-undo zu lösen, müssten wir bei jeder Änderung das komplette XML-Dokument serialisieren und bei jedem "Undo" neu parsen. Bei großen Dateien führt das zu extremen Rucklern (Frame Drops).
Fazit: Die Command-Variante (command.undo()) führt stattdessen eine gezielte Gegen-Operation auf demselben KML-Baum aus. Das ist schneller mit
O(1)) und schont den Speicher.

# Erkenntnis aus dem AR-Test in Göteborg: Warum Aachener Marker sichtbar waren

## Beobachtung

Die Datei `Templergraben.kml` enthält Marker in Aachen. Beim Test in Göteborg waren
diese Marker trotzdem in der AR-Kamera sichtbar. In einer ortsgebundenen AR-Anwendung
sollten Marker, die mehrere hundert Kilometer entfernt sind, nicht neben der Person
auftauchen.

Der Standortzugriff funktionierte nach der HTTPS- und Browser-Berechtigungskorrektur.
Der Fehler lag daher nicht am GPS des Telefons und auch nicht an den Koordinaten in
der KML-Datei, sondern daran, wie die Anwendung zwei verschiedene "Ursprünge"
behandelt hat.

## Die Begriffe in einfacher Sprache

GPS-Werte wie Aachen oder Göteborg sind globale Orte auf der Erde. Eine 3D-AR-Szene
arbeitet hingegen mit kleinen lokalen Meterwerten, etwa "drei Meter rechts und fünf
Meter vor mir". Um GPS in solche Meterwerte umzurechnen, braucht sie einen
Bezugspunkt: einen Anchor.

- Der **Dokument-Anchor** ist der Mittelpunkt der geöffneten KML-Datei. Bei
  `Templergraben.kml` liegt er in Aachen. Er ist für Editor und Desktop-Vorschau
  praktisch, weil die dortigen Marker nahe am lokalen Nullpunkt liegen.
- Der **Session-Anchor** ist die reale Position des Telefons beim Start einer
  AR-Session. Beim Test müsste er in Göteborg liegen.

Beide Anchors sind sinnvoll, haben aber verschiedene Bedeutungen: Der erste
beschreibt die Datei, der zweite beschreibt den Ort der Person.

## Was im Code passiert ist

1. Beim KML-Laden berechnet der Store den Mittelpunkt der Features und setzt ihn als
   einzigen Anchor. Für die Testdatei war das Aachen.
2. Beim AR-Start lieferte das Telefon einen GPS-Fix aus Göteborg.
3. Der AR-Code übernahm einen GPS-Fix jedoch nur dann, wenn noch kein Anchor gesetzt
   war. Der Dokument-Anchor aus Schritt 1 existierte bereits, also blieb Aachen aktiv.
4. Marker wurden dadurch relativ zu Aachen in die lokale Three.js-Szene umgerechnet
   und erschienen dort nahe am lokalen Nullpunkt.
5. Die 500-Meter-Ausblendung verglich nur diese bereits lokalen Three.js-Positionen
   mit der Kamera. Sie berechnete nicht erneut die Erd-Distanz Aachen--Göteborg und
   konnte den Fehler deshalb nicht erkennen.

Das war leicht zu übersehen, weil ein `GeoBridge`-Objekt für zwei Anwendungsfälle
wiederverwendet wurde. Der Code fragte nur "gibt es schon einen Anchor?" statt
"welcher Anchor gilt in diesem Modus?". Ein Test am gleichen Ort wie die KML deckt
diesen Unterschied nicht auf.

## Der geplante Fix

Die KML-Koordinaten bleiben unverändert; die Datei speichert weiterhin globale
GPS-Werte. Getrennt werden nur die lokalen Rechenkontexte:

1. Der Editor erhält eine Dokument-Projektion mit KML-Mittelpunkt als Anchor, für
   Import, Vorschau und Bearbeitung.
2. Jede AR-Session erhält eine eigene kurzlebige Session-Projektion. Ihr Anchor ist
   der erste ausreichend genaue GPS-Fix des Telefons.
3. Dieser Fix setzt die AR-Nullposition. Der Anchor bleibt danach pro Session stabil,
   damit GPS-Ungenauigkeit die Marker nicht sichtbar hin- und herspringen lässt.
4. Features ausserhalb des lokalen AR-Bereichs werden vor der lokalen Three.js-
   Projektion ausgeblendet. Eine Aachener Datei zeigt in Göteborg daher eine
   verständliche Meldung wie "Keine Features in AR-Reichweite" statt falsche Marker.
5. Beim Beenden der AR-Session wird nur die Session-Projektion verworfen. Die
   Dokument-Projektion bleibt für den Editor erhalten.

## Was wir daraus lernen

Ein Anchor ist nicht nur eine technische Variable. Er legt fest, was in einer
3D-Szene als "hier" gilt. Für einen KML-Editor bedeutet "hier" die Dokumentmitte;
für Live-AR bedeutet es der Standort des Geräts. Wenn beide Bedeutungen dieselbe
Variable teilen, kann GPS technisch funktionieren und trotzdem falsche AR-Ergebnisse
liefern. Künftige Tests müssen deshalb mindestens zwei Fälle enthalten: einen Test
nahe bei den KML-Markern und einen Test weit entfernt von ihnen.

# Prompt for creating Plan.md for each component
Create a plan.md for our folder kml-model/plan.md

You are acting as the lead software architect for this project.

The shared contracts have already been designed, reviewed and implemented.

DO NOT redesign them.
DO NOT invent new cross-component interfaces.
DO NOT move responsibilities between components.

Your task is to create the complete implementation plan for THIS COMPONENT ONLY.

The output must be a single file named:

plan.md

The purpose of this file is not to explain what the component does.

Instead, it should be a detailed engineering blueprint that another experienced engineer could follow without making architectural decisions themselves.

The implementation must fit into the overall architecture exactly.

The project is an offline-first browser application.

There is NO backend.

The .kml/.kmz file is the single source of persistent truth.

Google Earth compatibility is a hard requirement.

Untouched parts of KML must remain byte-faithful after saving.

The implementation order of the project is fixed:

contracts
→ kmz-io
→ kml-model
→ geo-bridge
→ renderers
→ commands
→ persistence
→ editor
→ ar-scene

The contracts already exist.

This component must strictly implement against them.

Never propose contract changes.

------------------------------------
YOUR TASK
------------------------------------

Produce an implementation plan that is deep enough that coding can begin immediately.

The document should aggressively eliminate ambiguity.

Whenever a decision can be made now, make it.

Whenever something is intentionally left flexible, explain why.

Avoid vague wording like:

"implement support"

"handle errors"

"manage state"

Instead explain exactly HOW.

------------------------------------
Required Sections
------------------------------------

## Overview

Explain the precise responsibility of this component.

Define its boundaries.

List explicitly:

• What it owns
• What it never owns
• Which contracts it consumes
• Which contracts it implements

## Internal Architecture

Design the internal modules.

Break the component into small implementation units.

For each unit explain:

- responsibility
- inputs
- outputs
- dependencies
- invariants

Explain why this decomposition minimizes coupling.

## Runtime Data Flow

Describe every important execution flow.

Examples:

loading

editing

saving

selection

rendering

undo

resource disposal

error handling

Describe step-by-step how data moves through the component.

## Public Surface

Describe every public class/function/module that will exist.

Do NOT redesign interfaces.

Instead explain how each contract implementation will internally work.

## Algorithms

Identify every non-trivial algorithm.

Explain:

purpose

steps

complexity

failure cases

numerical precision issues

edge cases

memory implications

Examples:

coordinate conversions

XML mutation

ZIP updates

geometry generation

selection

debouncing

command replay

resource caching

etc.

## State Management

Explain every piece of mutable state.

Who owns it.

Lifetime.

Synchronization rules.

Disposal.

Caching.

Invalidation.

## Error Strategy

Enumerate every expected failure.

Examples:

invalid KML

corrupt KMZ

missing assets

permission denied

unsupported feature

floating point precision

GPS unavailable

WebXR unavailable

etc.

Explain exact recovery behavior.

Never use generic "throw error".

## Performance Strategy

Discuss:

memory

CPU

large files

thousands of features

incremental updates

lazy loading

caching

object reuse

garbage generation

Explain why each optimization is or is not necessary.

## Testing Strategy

Provide a complete testing hierarchy.

Unit tests

Integration tests

Replay tests

Regression tests

Golden tests

Property tests

Edge cases

Failure cases

For every important behavior specify what is verified.

## Demo

Describe the standalone demo for this component.

Exactly what can be interacted with.

Exactly what proves the component works.

## Dependencies

List external libraries.

For each dependency explain:

why it exists

why alternatives were rejected

what assumptions are made

## Risks

List implementation risks ordered by severity.

For each:

why it is risky

how to detect problems early

mitigation

fallback plan

## Milestones

Split implementation into incremental milestones.

Each milestone should produce a working state.

Every milestone should be independently testable.

------------------------------------
Critical Constraints
------------------------------------

Never duplicate logic owned by another component.

Never leak implementation details across component boundaries.

Never access another component's internals.

Always go through contracts.

Never introduce hidden coupling.

Always preserve deterministic behavior.

Always prefer pure functions where possible.

Call out every architectural assumption.

If something depends on another component's behavior, explicitly state that dependency.

------------------------------------
Quality Bar
------------------------------------

The plan should read like an internal architecture document from a senior engineering team.

Avoid tutorials.

Avoid filler.

Avoid repeating the project description.

Focus on implementation decisions.

Assume the reader is an experienced TypeScript engineer.

The goal is that after reading plan.md there should be almost no remaining architectural uncertainty for this component.


## Prompts for iterations of plan.md
Best-practice review process

After PLAN.md is generated, run at least three separate review passes:

Failure-mode review — identify what could go wrong.
Alternative architecture review — generate competing approaches.
Assumption audit — challenge the premises behind the plan.

Research on prompting patterns consistently shows that techniques such as pre-mortems, devil's-advocate reviews, assumption hunting, and failure-mode analysis produce more critical and balanced outputs than simply asking "is this plan good?"

Prompt: Critical Architecture Reviewer

Use this immediately after PLAN.md is drafted:

You are now acting as a Senior Technical Reviewer.

Your job is NOT to improve the plan yet.
Your job is to find weaknesses.

Review the attached PLAN.md and produce:

1. Incorrect assumptions
2. Missing requirements
3. Architectural risks
4. Scalability concerns
5. Security concerns
6. Maintenance concerns
7. Areas that are over-engineered
8. Areas that are under-engineered

For every issue:

- Explain why it is a problem
- Estimate severity (Low/Medium/High)
- Suggest a possible mitigation

Do not defend the existing plan.
Assume your performance is measured by how many flaws you discover.

This works because it explicitly changes the model's objective from "helpful collaborator" to "reviewer."

Prompt: Devil's Advocate Review
Act as a devil's advocate.

Your goal is to convince a skeptical CTO that this plan should NOT be approved.

Identify:

- Hidden complexity
- Unrealistic assumptions
- Risky dependencies
- Failure scenarios
- Cost overruns
- Team capability mismatches
- User adoption risks

Make the strongest possible case against the proposal.

Do not provide balanced feedback.
Your sole objective is to find reasons the project could fail.

Studies and prompt-engineering guidance repeatedly recommend explicit devil's-advocate prompting because models naturally tend toward agreement and consensus.

Prompt: Alternative Architecture Generator

One of the biggest mistakes is only evaluating the architecture already chosen.

Review PLAN.md.

Assume the proposed architecture is forbidden.

Generate three fundamentally different approaches.

For each alternative:

- Core design
- Major components
- Advantages
- Disadvantages
- Cost implications
- Operational complexity
- When it would outperform the current plan

Finally, compare all approaches against the original proposal.

This forces exploration of the "road not taken," which has been shown to improve planning quality and reduce lock-in to early assumptions.

Prompt: Assumption Audit
Analyze PLAN.md.

List every assumption the plan depends on.

For each assumption:

- Why it exists
- Evidence supporting it
- Evidence against it
- What happens if it is false
- How the plan should change if it fails

Rank assumptions by project risk.

Assumption audits are particularly valuable because LLMs tend to recursively reinforce initial premises unless explicitly instructed to revisit them.

Prompt: Pre-Mortem Analysis
Assume this project launched 18 months ago and was a complete failure.

Write the postmortem.

Describe:

- What failed
- Why it failed
- Which warning signs were missed
- Which decisions caused the failure
- What should have been done differently

Then update the plan to prevent those failures.

Pre-mortem analysis is one of the most frequently recommended decision-review techniques because it reveals risks that optimism tends to hide.

Prompt: Expert Review Panel

Instead of a single reviewer, simulate multiple viewpoints.

Review PLAN.md as a panel of experts:

1. Staff Software Engineer
2. Security Architect
3. SRE / Platform Engineer
4. Product Manager
5. QA Lead

Each expert should:

- Identify concerns
- Challenge assumptions
- Suggest improvements

Then produce a summary of points where multiple experts disagreed.

Multi-perspective review often uncovers blind spots that a single critique misses. Research on debate-style evaluation suggests adversarial and multi-agent review improves the quality of assessments.

A strong workflow

A practical workflow after generating PLAN.md:

1. Generate PLAN.md
2. Run Assumption Audit
3. Run Devil's Advocate Review
4. Run Alternative Architecture Review
5. Run Pre-Mortem Analysis
6. Revise PLAN.md
7. Ask:

   "What are the 10 highest-risk decisions still remaining?"

8. Revise again
9. Freeze PLAN.md
