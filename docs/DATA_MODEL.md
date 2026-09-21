# World State Alpha minimum data model

Status: design candidate.

## Canonical record

```json
{
  "id": "wsr_k3m9...",
  "kind": "fact",
  "summary": "The bridge is destroyed and impassable.",
  "status": "active",
  "trend": null,
  "anchors": ["bridge", "Northglass Pass"],
  "createdAtMessage": 842,
  "lastChangedMessage": 842,
  "lastEvaluatedMessage": 842,
  "timeAnchor": "14 Frostwane 842",
  "evidenceIds": ["wse_..."],
  "causedBy": [],
  "affects": []
}
```

For a development:

```json
{
  "id": "wsr_...",
  "kind": "development",
  "summary": "Freight inspections are delaying trade and some merchants are diverting through Kesselpass.",
  "status": "active",
  "trend": "rising",
  "anchors": ["Hadrik", "Vardrenn", "Kesselpass", "freight inspections", "ore trade"],
  "createdAtMessage": 802,
  "lastChangedMessage": 845,
  "lastEvaluatedMessage": 845,
  "timeAnchor": "",
  "evidenceIds": ["wse_802", "wse_811", "wse_824", "wse_836", "wse_845"],
  "causedBy": [],
  "affects": []
}
```

### Field constraints

- `id`: deterministic/stable once created
- `kind`: `fact|development`
- `summary`: compact current truth, bounded length
- `status`: `active|resolved|superseded`
- `trend`: null or `emerging|rising|stable|falling|uncertain`
- `anchors`: optional bounded unique strings, not typed entities
- message fields: integer raw-message boundaries
- `timeAnchor`: optional opaque string
- `evidenceIds`: bounded references, with older evidence compactable
- causal links: bounded record IDs

No `scope`, region, faction, location type, severity score, probability, or mandatory title.

## Evidence

```json
{
  "id": "wse_...",
  "sourceMessageId": 845,
  "lineageKey": "fingerprint...",
  "sourceClass": "assistant_narration",
  "claim": "Some merchants diverted freight through Kesselpass.",
  "timeAnchor": "",
  "recordIds": ["wsr_..."]
}
```

Allowed source classes should remain small:

- `user_narration`
- `assistant_narration`
- `recent_history`
- `elapsed_hint`
- `lore_baseline`
- `manual`
- `rebuild`
- `foreign_import`

`lore_baseline` alone cannot create an active current record.

## Mutation proposal wire shape

```json
{
  "mutations": [
    {
      "action": "update",
      "recordId": "wsr_...",
      "kind": "development",
      "summary": "Current compact replacement summary",
      "status": "active",
      "trend": "rising",
      "anchors": ["..."],
      "reason": "Grounded causal reason",
      "evidence": [
        {
          "sourceMessageId": 845,
          "claim": "bounded evidence claim"
        }
      ],
      "relatedRecordIds": []
    }
  ]
}
```

The provider does not write storage directly. The deterministic reducer validates every proposal.

Phase 4 evolution uses the same canonical mutation model but marks the batch owner as `evolution`, so evaluation writes advance record provenance without masquerading as routine capture. A stable evaluation may add `elapsed_hint` evidence and advance `lastEvaluatedMessage` while leaving `lastChangedMessage` untouched.

Phase 5 does not change the persisted schema. Targeted operator corrections use `manual` evidence at an exact current raw-message head. Chronological rebuild reuses ordinary narrative evidence ownership checks, then stores accepted reconstructed evidence as `rebuild`. Foreign import uses `foreign_import` and clears local message/lineage provenance unless same-chat message provenance preservation is explicitly requested.

Phase 6 also changes no persisted schema. UI rows/details/diagnostics are bounded ephemeral projections derived from canonical state and allowlisted telemetry. UI selection/search state is presentation state only and is never persisted as canonical world truth.

## Per-chat state

```json
{
  "schemaVersion": 1,
  "records": [],
  "evidence": {},
  "links": [],
  "lineage": [],
  "rollbackJournalVersion": 1,
  "rollbackJournal": [],
  "rollbackHead": null,
  "checkpoints": [],
  "lastCaptureMessage": null
}
```

## Rollback entry

```json
{
  "seq": 17,
  "prevSeq": 16,
  "messageId": 845,
  "beforeMessageId": 844,
  "lineageKey": "...",
  "parentLineageKey": "...",
  "reason": "capture",
  "createdAt": 0,
  "undo": {
    "records": [],
    "evidence": [],
    "links": []
  }
}
```

Undo should be structural and record-level, not a full database copy per write.

## Deterministic IDs

Record IDs should derive from a generated stable random UUID/compact UUID at admission, not from mutable summary text.

Evidence IDs may combine source boundary + monotonic local sequence or UUID.

Semantic duplicate detection must not depend on ID derivation.


## Phase 7 host ownership metadata

Phase 7 does not change the canonical schema, sidecar format version, bundle version, or rollback journal version.

Host-only metadata lives outside canonical World State:

- `extension_settings.world_state_alpha.dataFiles[chatKey]` stores only the current sidecar pointer/revision/checksum returned by the storage boundary
- the owner-qualified `chatKey` distinguishes character and group ownership even when chat filenames match
- panel/search state and diagnostics remain non-canonical presentation/telemetry state
- no NPC State Delta pointer, dossier identifier, or external-extension state is stored in World State

The host storage adapter may translate a logical `world_state_alpha/<hash>.json` path into a SillyTavern uploaded filename, but the sidecar payload and checksum/revision semantics remain the Phase 1 format.
