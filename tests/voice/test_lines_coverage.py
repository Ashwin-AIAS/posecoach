"""S1 gate: data/voice/lines.yaml covers every fault id the P29 taxonomy mints.

Read-only against app/analysis — this test only imports from
app.voice.fault_taxonomy, which itself only reads app.analysis.form_scorer's
_CUES dict. No file under app/analysis or app/inference is touched by this
test or by anything it exercises.
"""

from __future__ import annotations

from app.voice.fault_taxonomy import (
    ALL_FAULT_IDS,
    CUE_TEXT_LOOKUP,
    MOVEMENT_FAULTS,
    SCOPED_EXERCISES,
    STATUS_FAULT_MODES,
)
from app.voice.personas import PERSONA_KEYS
from app.voice.schemas import LinesFile, load_lines_file


def _lines() -> LinesFile:
    return load_lines_file()


def test_lines_file_loads_and_validates() -> None:
    lines = _lines()
    assert set(lines.personas) == set(PERSONA_KEYS)
    assert set(lines.scope_exercises) == set(SCOPED_EXERCISES)


def test_every_enumerated_fault_id_is_covered() -> None:
    """Every fault id app/voice/fault_taxonomy.py mints has an entry."""
    lines = _lines()
    missing = set(ALL_FAULT_IDS) - set(lines.faults)
    assert not missing, f"lines.yaml is missing fault id(s): {sorted(missing)}"


def test_no_extra_fault_ids_in_lines_file() -> None:
    """lines.yaml never invents a fault id the taxonomy did not mint."""
    lines = _lines()
    extra = set(lines.faults) - set(ALL_FAULT_IDS)
    assert not extra, f"lines.yaml has fault id(s) not in the P29 taxonomy: {sorted(extra)}"


def test_every_fault_has_a_line_for_all_three_personas() -> None:
    lines = _lines()
    for fault_id, entry in lines.faults.items():
        assert set(entry.lines) == set(PERSONA_KEYS), (
            f"{fault_id}: has lines for {sorted(entry.lines)}, expected all of {sorted(PERSONA_KEYS)}"
        )


def test_no_line_is_empty() -> None:
    lines = _lines()
    for fault_id, entry in lines.faults.items():
        for persona, text in entry.lines.items():
            assert text.strip(), f"{fault_id}.{persona}: line is empty"


def test_no_line_is_duplicated_across_personas_for_the_same_fault() -> None:
    """Each persona must say something distinct for a given fault (own register)."""
    lines = _lines()
    for fault_id, entry in lines.faults.items():
        texts = list(entry.lines.values())
        assert len(texts) == len(set(texts)), f"{fault_id}: duplicate line text across personas: {texts}"


def test_movement_faults_are_coach_mode_with_both_sides() -> None:
    lines = _lines()
    movement_ids = {f.fault_id for f in MOVEMENT_FAULTS}
    for fault_id in movement_ids:
        entry = lines.faults[fault_id]
        assert entry.modes == ("coach",), f"{fault_id}: expected modes=('coach',), got {entry.modes}"
        assert entry.sides == ("left", "right"), f"{fault_id}: expected both sides, got {entry.sides}"


def test_status_faults_have_no_sides_and_correct_modes() -> None:
    lines = _lines()
    for fault_id, expected_modes in STATUS_FAULT_MODES.items():
        entry = lines.faults[fault_id]
        assert entry.sides == (), f"{fault_id}: status fault must have no sides, got {entry.sides}"
        assert set(entry.modes) == set(expected_modes), (
            f"{fault_id}: expected modes {expected_modes}, got {entry.modes}"
        )


def test_side_placeholder_only_appears_where_sides_are_declared() -> None:
    """{side} may appear only in lines whose fault entry declares sides (S1 amendment B)."""
    lines = _lines()
    for fault_id, entry in lines.faults.items():
        for persona, text in entry.lines.items():
            has_placeholder = "{side}" in text
            if not entry.sides:
                assert not has_placeholder, f"{fault_id}.{persona}: no-side fault must not use {{side}}"


def test_vector_uses_the_side_placeholder_on_every_movement_fault() -> None:
    """VECTOR's register ('reads state back') is expected to name the side."""
    lines = _lines()
    for fault_id in (f.fault_id for f in MOVEMENT_FAULTS):
        vector_text = lines.faults[fault_id].lines["vector"]
        assert "{side}" in vector_text, f"{fault_id}.vector: expected a {{side}} placeholder"


def test_cue_text_lookup_has_no_collisions_and_covers_every_movement_fault() -> None:
    """(exercise, cue_text) -> fault_id table is injective and complete."""
    assert len(CUE_TEXT_LOOKUP) == len(MOVEMENT_FAULTS)
    resolved_ids = set(CUE_TEXT_LOOKUP.values())
    assert resolved_ids == {f.fault_id for f in MOVEMENT_FAULTS}


def test_taxonomy_matches_the_live_scorer_today() -> None:
    """Guards against silent drift: re-derive the fault count from _CUES.

    This mirrors app.voice.fault_taxonomy's own derivation but asserts the
    result shape directly, so a future change to app/analysis/form_scorer.py
    that alters the scoped exercises' joint sets fails this test loudly
    instead of leaving lines.yaml stale.
    """
    from app.analysis.form_scorer import _CUES

    expected_template_count = 0
    for exercise in SCOPED_EXERCISES:
        joint_bases: set[str] = set()
        for joint in _CUES[exercise]:
            base = joint.removeprefix("left_").removeprefix("right_")
            joint_bases.add(base)
        expected_template_count += len(joint_bases) * 2  # low + high
    assert len(MOVEMENT_FAULTS) == expected_template_count
    assert len(ALL_FAULT_IDS) == expected_template_count + len(STATUS_FAULT_MODES)
