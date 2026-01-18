"""Three-way merge utilities for file conflict resolution."""
import difflib
from typing import Tuple, List, Optional


def three_way_merge(original: str, user_version: str, disk_version: str) -> Tuple[str, bool, List[str]]:
    """
    Perform a three-way merge between original content, user's changes, and disk changes.

    Args:
        original: The original content when file was loaded
        user_version: The user's modified content (what they want to save)
        disk_version: The current content on disk (may have been modified by others)

    Returns:
        Tuple of:
        - merged_content: The merged result
        - has_conflicts: True if there were unresolvable conflicts
        - conflict_markers: List of conflict descriptions if any
    """
    # Split into lines for line-by-line merging
    original_lines = original.splitlines(keepends=True)
    user_lines = user_version.splitlines(keepends=True)
    disk_lines = disk_version.splitlines(keepends=True)

    # Get diffs
    user_diff = list(difflib.unified_diff(original_lines, user_lines, lineterm=''))
    disk_diff = list(difflib.unified_diff(original_lines, disk_lines, lineterm=''))

    # If no changes from either side, return original
    if not user_diff and not disk_diff:
        return original, False, []

    # If only user made changes, use user version
    if not disk_diff:
        return user_version, False, []

    # If only disk changed (user made no changes), use disk version
    if not user_diff:
        return disk_version, False, []

    # Both made changes - need to merge
    # Use SequenceMatcher to identify change blocks

    conflicts = []
    merged_lines = []

    # Get matching blocks between original and each version
    user_matcher = difflib.SequenceMatcher(None, original_lines, user_lines)
    disk_matcher = difflib.SequenceMatcher(None, original_lines, disk_lines)

    user_opcodes = user_matcher.get_opcodes()
    disk_opcodes = disk_matcher.get_opcodes()

    # Build change maps: original_index -> (user_change, disk_change)
    user_changes = {}  # original line index -> list of replacement lines
    disk_changes = {}  # original line index -> list of replacement lines

    for tag, i1, i2, j1, j2 in user_opcodes:
        if tag in ('replace', 'delete', 'insert'):
            for i in range(i1, max(i2, i1 + 1)):
                if tag == 'insert' and i == i1:
                    user_changes[i] = ('insert', user_lines[j1:j2])
                elif tag == 'delete':
                    user_changes[i] = ('delete', [])
                elif tag == 'replace':
                    if i == i1:
                        user_changes[i] = ('replace', user_lines[j1:j2])
                    else:
                        user_changes[i] = ('delete', [])

    for tag, i1, i2, j1, j2 in disk_opcodes:
        if tag in ('replace', 'delete', 'insert'):
            for i in range(i1, max(i2, i1 + 1)):
                if tag == 'insert' and i == i1:
                    disk_changes[i] = ('insert', disk_lines[j1:j2])
                elif tag == 'delete':
                    disk_changes[i] = ('delete', [])
                elif tag == 'replace':
                    if i == i1:
                        disk_changes[i] = ('replace', disk_lines[j1:j2])
                    else:
                        disk_changes[i] = ('delete', [])

    # Process line by line
    has_conflicts = False
    i = 0
    processed_inserts = set()

    while i < len(original_lines):
        user_change = user_changes.get(i)
        disk_change = disk_changes.get(i)

        if user_change is None and disk_change is None:
            # No changes, keep original
            merged_lines.append(original_lines[i])
        elif user_change is None:
            # Only disk changed
            change_type, new_lines = disk_change
            if change_type == 'delete':
                pass  # Skip this line (deleted)
            elif change_type in ('replace', 'insert'):
                merged_lines.extend(new_lines)
        elif disk_change is None:
            # Only user changed
            change_type, new_lines = user_change
            if change_type == 'delete':
                pass  # Skip this line (deleted)
            elif change_type in ('replace', 'insert'):
                merged_lines.extend(new_lines)
        else:
            # Both changed this line - potential conflict
            user_type, user_new = user_change
            disk_type, disk_new = disk_change

            # Check if changes are identical
            if user_new == disk_new:
                # Same change, no conflict
                if user_type != 'delete':
                    merged_lines.extend(user_new)
            else:
                # Conflict - include both with markers
                has_conflicts = True
                line_num = i + 1
                conflicts.append(f"Conflict at line {line_num}")

                merged_lines.append(f"<<<<<<< YOUR CHANGES\n")
                merged_lines.extend(user_new if user_new else [f"(line deleted)\n"])
                merged_lines.append(f"=======\n")
                merged_lines.extend(disk_new if disk_new else [f"(line deleted)\n"])
                merged_lines.append(f">>>>>>> DISK VERSION\n")

        i += 1

    merged_content = ''.join(merged_lines)

    # Ensure file ends with newline if original did
    if original.endswith('\n') and not merged_content.endswith('\n'):
        merged_content += '\n'

    return merged_content, has_conflicts, conflicts


def simple_merge(original: str, user_version: str, disk_version: str) -> Tuple[str, bool]:
    """
    Simplified merge that applies non-conflicting changes automatically.
    For conflicting changes, user's version wins but we return has_conflicts=True.

    Returns:
        Tuple of (merged_content, changes_were_made_by_others)
    """
    # If disk version equals original, no external changes
    if disk_version == original:
        return user_version, False

    # If user version equals original, user made no changes - use disk version
    if user_version == original:
        return disk_version, True

    # If user version equals disk version, no conflict
    if user_version == disk_version:
        return user_version, False

    # Both made changes - try to merge
    merged, has_conflicts, _ = three_way_merge(original, user_version, disk_version)

    if has_conflicts:
        # For simplicity, prefer user changes but notify about conflict
        # Return the merged result with conflict markers
        return merged, True

    return merged, True
