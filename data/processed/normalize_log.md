# PSI normalization log

Generated offline from files already stored under data/raw/. No network requests were made.
All source row numbers are one-based data-record indices from pandas parsing; the CSV header is not counted.
Floating-point values are rounded to two decimals only when written to JSON.

## Table-by-table results

| Investigation | Table key | Adapter | Source file | Rows in | Points/records out | Rows skipped | Collapsed duplicate rows | Skip reasons |
|---|---|---|---|---:|---:|---:|---:|---|
| PSI-10 | inverse | adapt_psi_10_inverse (test) | PSI-10_Experimental table_Flame Design_Inverse Flame.csv | 120 | 120 | 0 | 0 | — |
| PSI-10 | normal | adapt_psi_10_normal (test) | PSI-10_Experimental table_Flame Design_Normal Flame.csv | 207 | 207 | 0 | 0 | — |
| PSI-100 | saffire-iii | adapt_psi_100_saffire_iii (test) | PSI-100_Experimental table_SAFFIRE-3.csv | 2 | 2 | 0 | 0 | — |
| PSI-101 | same-r | adapt_psi_101_same_r (detection) | PSI-101_Experimental table_SAME-R.csv | 109 | 109 | 0 | 0 | — |
| PSI-102 | same | adapt_psi_102_same (detection) | PSI-102_Experimental table_SAME.csv | 8 | 8 | 0 | 0 | — |
| PSI-106 | slice | adapt_psi_106_slice (envelope) | PSI-106_Experimental table_Slice.csv | 12 | 12 | 0 | 0 | — |
| PSI-107 | spice | adapt_psi_107_spice (test) | PSI-107_Experimental table_Spice.csv | 469 | 435 | 0 | 34 | — |
  - Flagged: rows 295: Air Rate=-0.28 cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null
  - Flagged: rows 297: Air Rate=-0.28 cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null
  - Flagged: rows 298: Air Rate=-0.28 cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null
  - Flagged: rows 299: Air Rate=-0.28 cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null
  - Flagged: rows 300: Air Rate=-0.28 cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null
  - Flagged: rows 336: Air Rate=-5.92 cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null
  - Flagged: rows 337: Air Rate=-5.92 cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null
  - Flagged: rows 338: Air Rate=-5.92 cm/s is negative; preserved in metrics.source_flow_cm_s and flow_cm_s is null
  - Repeated rows were grouped by date, ignition time, fuel, nozzle, fuel rate (sccm), and air rate (cm/s); grouped source row indices are retained on each point.
| PSI-142 | data-summary | adapt_psi_142_data_summary (envelope) | PSI-142_Experimental table_Data Summary Table.csv | 8 | 8 | 0 | 0 | — |
| PSI-159 | inverse | adapt_psi_159_inverse (test) | PSI-159_Experimental table_CFI-G_Inverse Flames.csv | 1015 | 154 | 861 | 0 | blank CSV record: 861 |
  - Skipped-row examples: row 155 (blank CSV record), row 156 (blank CSV record), row 157 (blank CSV record), row 158 (blank CSV record), row 159 (blank CSV record), row 160 (blank CSV record), row 161 (blank CSV record), row 162 (blank CSV record) …
  - The inventory manifest reports 154 populated rows; the CSV parser also exposes 861 empty records (1,015 parsed records total). Empty records are skipped; populated source rows remain traceable.
| PSI-159 | normal | adapt_psi_159_normal (test) | PSI-159_Experimental table_CFI-G_Normal Flames.csv | 179 | 179 | 0 | 0 | — |
| PSI-20 | bre | adapt_psi_20_bre (envelope) | PSI-20_Experimental table_ACME BRE.csv | 18 | 18 | 0 | 0 | — |
| PSI-21 | cld | adapt_psi_21_cld (envelope) | PSI-21_Experimental table_CLD Flame.csv | 32 | 32 | 0 | 0 | — |
| PSI-22 | e-field | adapt_psi_22_efield (envelope) | PSI-22_Experimental table_ACME E-FIELD Flames.csv | 32 | 32 | 0 | 0 | — |
| PSI-23 | s-flame | adapt_psi_23_s_flame (envelope) | PSI-23_Experimental table_ACME s-Flame.csv | 18 | 18 | 0 | 0 | — |
| PSI-25 | bass-ii | adapt_psi_25_bass_ii (test) | PSI-25_Experimental table_BASS-II.csv | 129 | 129 | 0 | 0 | — |
| PSI-26 | bass | adapt_psi_26_bass (test) | PSI-26_Experimental table_BASS.csv | 122 | 121 | 1 | 0 | maintenance/cleaning record without a test number: 1 |
  - Skipped-row examples: row 66 (maintenance/cleaning record without a test number)
| PSI-39 | cfi | adapt_psi_39_cfi (test) | PSI-39_Experimental table_CFI.csv | 87 | 87 | 0 | 0 | — |
| PSI-47 | daft | adapt_psi_47_daft (detection) | PSI-47_Experimental table_DAFT.csv | 2 | 2 | 0 | 0 | — |
| PSI-68 | flex-2 | adapt_psi_68_flex2 (envelope) | PSI-68_Experimental table_Flex2.csv | 8 | 8 | 0 | 0 | — |
| PSI-69 | flex | adapt_psi_69_flex (test) | PSI-69_Experimental table_FLEX.csv | 274 | 274 | 0 | 0 | — |
  - Outcome mapping: Completion (27) → burned; Disruption (61) → burned; Extinction (186) → self_extinguished
  - Flagged: row 114: Ambient pressure=0.0 mmHg converts to 0.00 psi, outside the validated (0, 120) psi field range; retained in metrics.source_pressure_psi and pressure_psi is null
| PSI-98 | saffire-i | adapt_psi_98_saffire_i (test) | PSI-98_Experimental table_SAFFIRE-1.csv | 4 | 2 | 2 | 0 | pre-test flow-visualization reference, not a burn test: 2 |
  - Skipped-row examples: row 3 (pre-test flow-visualization reference, not a burn test), row 4 (pre-test flow-visualization reference, not a burn test)
| PSI-99 | saffire-ii | adapt_psi_99_saffire_ii (test) | PSI-99_Experimental table_SAFFIRE-2.csv | 15 | 9 | 6 | 0 | editorial note row, not a sample test: 4; pre-test flow-visualization reference, not a burn test: 2 |
  - Skipped-row examples: row 10 (pre-test flow-visualization reference, not a burn test), row 11 (pre-test flow-visualization reference, not a burn test), row 12 (editorial note row, not a sample test), row 13 (editorial note row, not a sample test), row 14 (editorial note row, not a sample test), row 15 (editorial note row, not a sample test)
  - Flagged: row 4: PSI-99 source reports sample thickness as '037 mm'. A possible reading is 0.37 mm, but the source value is retained without correction.
  - Flagged: row 5: PSI-99 source reports sample thickness as '037 mm'. A possible reading is 0.37 mm, but the source value is retained without correction.
  - Flagged: row 6: PSI-99 source reports sample thickness as '037 mm'. A possible reading is 0.37 mm, but the source value is retained without correction.

## Output counts

- Test points: 1719
- Envelopes: 128
- Detection records: 119
- Investigations: 25 (one per cached detail JSON)

## FLEX Test end mapping

| Raw PSI value | Count | Normalized outcome |
|---|---:|---|
| Completion | 27 | burned |
| Disruption | 61 | burned |
| Extinction | 186 | self_extinguished |

## Explicit assumptions and mapping notes

- PSI-159 and PSI-10 normal-flame O2 fields describe ambient chamber oxygen; inverse-flame O2 is burner-stream oxygen. `extra.o2_semantics` records `ambient` or `burner_stream`.
- PSI-25 and PSI-26 pressure is set to 14.7 psi as an explicit MSG/ISS cabin assumption; PSI-98/99/100 pressure is set to 14.7 psi as an explicit Cygnus cabin assumption.
- PSI-107 O2 (20.9%) and pressure (14.7 psi) are assumptions; the source table contains neither field.
- PSI-25 O2 and CO changes are metrics only; they do not determine an outcome. PSI-26 has no O2 field and retains null.
- PSI-100 SAFFIRE-III has no O2 or burn-outcome column; O2 remains null and outcome is unknown.
- PSI-20/21/22/23/68/106/142 remain envelopes; fuel concentration is never re-labeled as oxygen concentration.
- No PSI value absent from the raw files was silently filled. Missing measurement reasons are attached to each affected test point.
