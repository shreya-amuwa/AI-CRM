#!/usr/bin/env python3
"""
Replaces the real-sounding example details in the downloadable Excel templates with placeholders (Customer_Name, Business_Name ...).

The example row of a template is dummy data that only shows the format; it must never contain a real person or business. This changes ONLY the
text of the example cells (and the cell comments), nothing else, and is safe to run again (nothing left to replace = no change):

    python3 scripts/scrub_template_examples.py

The example rows are still recognised by the import through the dummy mobile number 9820011111 and the word EXAMPLE, so the import does not
change. Then rebuild the one-sheet template, which copies its lists from the Team template:  python3 scripts/build_one_sheet_template.py
"""
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    ROOT / 'public/templates/Customer_Upload_Template.xlsx',
    ROOT / 'public/templates/Existing_Customers_Services_Usage.xlsx',
    ROOT / 'public/templates/Existing_Customers_Services_Usage_Team.xlsx',
]
# the longest first (a short one can be part of a longer one)
REPLACE = [
    ('Shop 4, Station Road, Thane', 'Business_Address'),
    ('https://instagram.com/galaxy', 'https://instagram.com/page_name'),
    ('galaxy@example.com', 'customer@example.com'),
    ('Galaxy Jewellers', 'Business_Name'),
    ('Siddhesh Patil', 'Customer_Name'),
    ('Priya Sharma', 'Relationship_Manager_Name'),
    ('Rahul Mehta', 'Referrer_Name'),
    ('Mohan Member', 'Support_Member_Name'),
    ('Jewellery', 'Business_Category'),
    ('Thane', 'City_Name'),
    ('Sneha', 'Agent_Name'),
    ('7965318731', '9820011113'),
]
FORBIDDEN = [old for old, _ in REPLACE if old != 'Thane'] + ['Thane']


def scrub(text: str) -> str:
    for old, new in REPLACE:
        text = text.replace(old, new)
    return text


def run(path: Path) -> int:
    wb = openpyxl.load_workbook(path)
    changed = 0
    for ws in wb:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and not cell.value.startswith('='):
                    new = scrub(cell.value)
                    if new != cell.value:
                        cell.value = new
                        changed += 1
                if cell.comment is not None:
                    new = scrub(cell.comment.text)
                    if new != cell.comment.text:
                        cell.comment.text = new
                        changed += 1
    if changed:
        wb.save(path)
    return changed


if __name__ == '__main__':
    for f in FILES:
        print(f'{f.name}: {run(f)} cells changed')
