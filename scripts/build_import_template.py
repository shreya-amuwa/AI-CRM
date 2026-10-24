#!/usr/bin/env python3
"""
Makes the existing-customer Excel templates easier to fill (public/templates/Existing_Customers_Services_Usage*.xlsx).

What the data-entry person no longer types (every cell can still be overtyped):
  * the mobile number in sheets 3, 5 and 6: those rows are listed for them, from the customers who have that service in "2 Services";
  * the customer's name: every sheet shows "Customer (auto)" next to the mobile number, so a wrong number is seen at once;
  * the renewal date (start date + billing cycle), the panel / platform of the service, the panel login (the customer's e-mail),
    the display name, the package size in messages, the date the subscription ends, the unit of a monthly deliverable;
  * "Data as of" and the Support Team Member, which are set once on the "Set once" tab;
  * the mobile number elsewhere is picked from a drop-down of the customers in sheet 1.
It also adds the optional "Client Password" column to "1 Customers" (the team sets the client's password; the CRM keeps only the
hash that Supabase Auth makes; the client is e-mailed the sign-in details once).

Run it once on a template that does not have these changes yet (a template that already has them is left alone):
    python3 scripts/build_import_template.py
The import reads the sheets by their column headings, so old files keep importing.
"""
import copy
import re
import sys
from pathlib import Path

import openpyxl
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.cell_range import CellRange, MultiCellRange
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = [ROOT / 'public/templates/Existing_Customers_Services_Usage.xlsx', ROOT / 'public/templates/Existing_Customers_Services_Usage_Team.xlsx']
LAST = 501  # last data row of the lookup ranges (the sheets hold 500 customers)

AUTO_FILL = PatternFill('solid', fgColor='E3EFEC')   # the template's "calculated" colour
SET_FILL = PatternFill('solid', fgColor='FFF4CC')    # a cell the person fills once
HEADER_ROW = {'1 Customers': 1, '2 Services': 1, '3 WhatsApp Account': 2, '4 WhatsApp Campaigns': 2, '5 AI Calling': 2, '6 RCS & Voice': 2, '7 Monthly Deliverables': 2}

WA = 'WhatsApp API + Blue Tick'
AI = 'AI Calling'
RCS, VOICE = 'RCS Registration + Platform', 'Voice Message (Bulk)'
PACKAGES = [('50,000', 50000), ('1 Lakh', 100000), ('2 Lakh', 200000), ('5 Lakh', 500000), ('10 Lakh', 1000000), ('Custom', None)]
PANELS = ['Wabastore (chat.wabastore.shop)', 'Whatsbox(app.whatsbox.shop)', 'Bolify AI', 'Crocodile', 'Meta Business Suite', 'Google', 'Other']
DEFAULT_PANEL = {WA: 'Wabastore (chat.wabastore.shop)', AI: 'Bolify AI'}


def shift_sqref(sqref, at):
    """Column `at` and everything right of it moves one column to the right."""
    out = []
    for cr in sqref.ranges:
        lo, hi = cr.min_col, cr.max_col
        if lo >= at:
            lo, hi = lo + 1, hi + 1
        elif hi >= at:
            hi += 1
        out.append(CellRange(min_col=lo, max_col=hi, min_row=cr.min_row, max_row=cr.max_row))
    return MultiCellRange(out)


def insert_column(ws, at, last_row):
    """Insert a column at `at` (formulas in the moved cells keep pointing at the same neighbours; widths, validations and freeze follow)."""
    max_col = ws.max_column
    merged = [str(m) for m in ws.merged_cells.ranges]
    for m in merged:
        ws.unmerge_cells(m)
    widths = {c: ws.column_dimensions[L(c)].width for c in range(1, max_col + 1) if L(c) in ws.column_dimensions}
    ws.move_range(f'{L(at)}1:{L(max_col)}{last_row}', cols=1, translate=True)
    for c in range(max_col + 1, at, -1):
        ws.column_dimensions[L(c)].width = widths.get(c - 1, 14)
    ws.column_dimensions[L(at)].width = 40 if at == 2 else 24
    for m in merged:
        cr = CellRange(m)
        if cr.max_col >= at:
            cr.expand(right=1)
        ws.merge_cells(str(cr))
    for dv in ws.data_validations.dataValidation:
        dv.sqref = shift_sqref(dv.sqref, at)
    if ws.freeze_panes:
        m = re.match(r'([A-Z]+)(\d+)', ws.freeze_panes)
        col = openpyxl.utils.column_index_from_string(m.group(1))
        ws.freeze_panes = f'{L(col + 1 if at <= col else col)}{m.group(2)}'


def style_like(dst, src):
    dst.font, dst.fill, dst.border, dst.alignment = copy.copy(src.font), copy.copy(src.fill), copy.copy(src.border), copy.copy(src.alignment)
    dst.number_format, dst.protection = src.number_format, copy.copy(src.protection)


def add_dv(ws, dv):
    ws.add_data_validation(dv)
    return dv


def drop_dv(ws, col_letter):
    """Remove the validation that covers (only) the given column."""
    keep = []
    for dv in ws.data_validations.dataValidation:
        cols = {c for cr in dv.sqref.ranges for c in range(cr.min_col, cr.max_col + 1)}
        if cols == {openpyxl.utils.column_index_from_string(col_letter)}:
            continue
        keep.append(dv)
    ws.data_validations.dataValidation = keep


def lookup_index(match_value):
    return f"MATCH({match_value},'1 Customers'!$N$2:$N${LAST},0)"


def build(path: Path):
    wb = openpyxl.load_workbook(path)
    if wb['2 Services']['B1'].value == 'Customer (auto)':
        print(f'{path.name}: already done, left alone')
        return
    team = 'Support Team' in wb.sheetnames
    cust, svc = wb['1 Customers'], wb['2 Services']

    # ---- Lists (hidden): packages, panels, units ----------------------------------------------------------------------------
    lists = wb['Lists']
    units = {}
    guide = wb['8 Metrics Guide']
    for r in range(2, guide.max_row + 1):
        name, usage = guide.cell(r, 2).value, str(guide.cell(r, 5).value or '')
        m = re.search(r'Unit:\s*(.+)', usage)
        if name and m:
            units[name] = m.group(1).strip()
    for i, (label, n) in enumerate(PACKAGES, start=1):
        lists.cell(i, 3, label)
        lists.cell(i, 4, n)
    for i, p in enumerate(PANELS, start=1):
        lists.cell(i, 5, p)
    for i, (s, p) in enumerate(DEFAULT_PANEL.items(), start=1):
        lists.cell(i, 6, s)
        lists.cell(i, 7, p)
    for i, (s, u) in enumerate(units.items(), start=1):
        lists.cell(i, 8, s)
        lists.cell(i, 9, u)

    # ---- Set once --------------------------------------------------------------------------------------------------------------
    once = wb.create_sheet('Set once', 1)
    once.sheet_properties.tabColor = 'F5B400'
    once.column_dimensions['A'].width = 62
    once.column_dimensions['B'].width = 36
    once['A1'] = 'Set once - used in every sheet'
    once['A1'].font = Font(bold=True, size=14)
    once['A2'] = 'Yellow cells are typed here one time. The sheets fill themselves from them; you can still type over any cell.'
    once['A2'].font = Font(italic=True)
    once['A4'] = '"Data as of" - the day you read the numbers from the panels'
    once['B4'].fill, once['B4'].number_format = SET_FILL, 'DD-MM-YYYY'
    add_dv(once, DataValidation(type='date', operator='greaterThan', formula1='DATE(2018,1,1)', allow_blank=True, showErrorMessage=True,
                                error='Type the date as DD-MM-YYYY.')).add('B4')
    row = 5
    if team:
        once['A5'] = 'Support Team Member (looks after the customers in "1 Customers")'
        once['B5'].fill = SET_FILL
        add_dv(once, DataValidation(type='list', formula1="='Support Team'!$A$2:$A$200", allow_blank=True, showErrorMessage=True,
                                    error='Pick a name from the Support Team tab.')).add('B5')
        row = 6
    once[f'A{row + 1}'] = 'What the other sheets fill in for you'
    once[f'A{row + 1}'].font = Font(bold=True)
    for i, line in enumerate([
        'Mobile number: type it ONCE in "1 Customers". Sheets 3, 5 and 6 list the customers who have that service in "2 Services".',
        'Sheets 2, 4 and 7: pick the mobile number from the drop-down; "Customer (auto)" shows whose it is (red = not in sheet 1).',
        '"2 Services": the Renewal date comes from the Start Date and the Billing Cycle; Panel / Platform from the service; Panel Login from the customer\'s e-mail.',
        '"3 WhatsApp Account": Display Name, Messages in Package (from Message Package) and Subscription Ends come by themselves.',
        '"5 AI Calling" and "6 RCS & Voice": Platform, the service and "Valid Until" come by themselves.',
        '"7 Monthly Deliverables": the unit comes from the service.',
        'Light-green cells are filled by the sheet. Type over one if it is wrong for a customer.',
    ], start=row + 2):
        once[f'A{i}'] = line
        once[f'A{i}'].alignment = Alignment(wrap_text=True, vertical='top')
    set_once_asof = "'Set once'!$B$4"
    set_once_member = "'Set once'!$B$5"

    # ---- 1 Customers: Client Password (K) + helper key (N) ----------------------------------------------------------------------
    insert_column(cust, 11, cust.max_row)
    style_like(cust['K1'], cust['J1'])
    cust['K1'] = 'Client Password'
    cust['K1'].comment = Comment(
        'Optional. The password the client signs in with (at least 10 characters). The client is e-mailed their dashboard address, '
        'login e-mail and this password once; the CRM keeps only the hash (Supabase Auth). Leave it empty to let the client choose '
        'their own from an e-mail. Delete this column or the file once the import is done.', 'CRM')
    cust.column_dimensions['K'].width = 24
    for r in range(2, cust.max_row + 1):
        style_like(cust.cell(r, 11), cust.cell(r, 10))
        cust.cell(r, 11).number_format = '@'
    cust['K2'] = '(optional)'
    add_dv(cust, DataValidation(type='textLength', operator='greaterThanOrEqual', formula1='10', allow_blank=True, showErrorMessage=True,
                                errorStyle='warning', errorTitle='Client Password', error='Use at least 10 characters.')).add(f'K3:K{LAST + 1}')
    cust['N1'] = 'Mobile key (helper)'
    for r in range(2, LAST + 2):
        cust.cell(r, 14, f'=IF(A{r}="","",TEXT(A{r},"0"))')
    cust.column_dimensions['N'].hidden = True
    if team:
        for r in range(3, LAST + 2):
            cust.cell(r, 9, f'=IF(OR(A{r}="",{set_once_member}=""),"",{set_once_member})').fill = AUTO_FILL

    # ---- 2 Services: Customer (auto) in B, defaults, helpers --------------------------------------------------------------------
    insert_column(svc, 2, svc.max_row)
    # columns now: A mobile, B customer, C service, D plan, E price, F cycle, G start, H renewal, I days left, J status, K platform, L panel login, M notes
    def customer_cell(ws, hdr, first, last):
        style_like(ws.cell(hdr, 2), ws.cell(hdr, 1))
        ws.cell(hdr, 2).value = 'Customer (auto)'
        idx = lookup_index(f'TEXT($A{{r}},"0")')
        for r in range(first, last + 1):
            c = ws.cell(r, 2)
            m = idx.format(r=r)
            c.value = (f'=IF($A{r}="","",IFERROR(INDEX(\'1 Customers\'!$C$2:$C${LAST},{m})&" ("&INDEX(\'1 Customers\'!$B$2:$B${LAST},{m})&")","Not in sheet 1"))')
            c.fill, c.font, c.number_format = AUTO_FILL, Font(italic=False), 'General'
        # a mobile that is not in sheet 1 is shown in red (it may be an existing CRM customer: allowed, but worth a look)
        ws.conditional_formatting.add(f'A{first}:A{last}', FormulaRule(
            formula=[f'AND($A{first}<>"",COUNTIF(\'1 Customers\'!$N$2:$N${LAST},TEXT($A{first},"0"))=0)'], fill=PatternFill(fill_type='solid', start_color='F8D0D0', end_color='F8D0D0')))

    last_svc = svc.max_row
    customer_cell(svc, 1, 2, last_svc)
    for r in range(3, last_svc + 1):
        svc.cell(r, 8).value = (f'=IF(OR(G{r}="",F{r}=""),"",IFERROR(EDATE(G{r},IF(F{r}="Monthly",1,IF(F{r}="Quarterly",3,IF(F{r}="Half-yearly",6,IF(F{r}="Yearly",12,"x"))))),""))')
        svc.cell(r, 8).fill = AUTO_FILL
        svc.cell(r, 11).value = f'=IF(C{r}="","",IFERROR(VLOOKUP(C{r},Lists!$F$1:$G$20,2,FALSE),""))'
        svc.cell(r, 11).fill = AUTO_FILL
        svc.cell(r, 12).value = (f'=IF($A{r}="","",IFERROR(INDEX(\'1 Customers\'!$D$2:$D${LAST},{lookup_index(f"TEXT($A{r},\"0\")")})&"",""))')
        svc.cell(r, 12).fill = AUTO_FILL
    drop_dv(svc, 'K')
    add_dv(svc, DataValidation(type='list', formula1='=Lists!$E$1:$E$7', allow_blank=True, showErrorMessage=True, errorStyle='warning',
                               error='Pick a panel from the list, or keep what you typed.')).add(f'K3:K{last_svc}')
    drop_dv(svc, 'A')
    add_dv(svc, DataValidation(type='list', formula1=f"='1 Customers'!$A$2:$A${LAST}", allow_blank=True, showErrorMessage=True, errorStyle='warning',
                               errorTitle='Mobile number', error='This mobile number is not in "1 Customers". Keep it only for an existing CRM customer.')).add(f'A2:A{last_svc}')
    # helpers (hidden): which services each customer has, counted in order, to list them in sheets 3, 5, 6
    svc['N1'], svc['O1'], svc['P1'], svc['Q1'] = 'WhatsApp # (helper)', 'AI Calling # (helper)', 'RCS/Voice # (helper)', 'Key (helper)'
    ex = '"9820011111"'
    for r in range(2, last_svc + 1):
        mine = f'AND($A{r}<>"",$A{r}<>{ex}'
        svc.cell(r, 14, f'=IF({mine},$C{r}="{WA}"),MAX(N$1:N{r - 1})+1,"")')
        svc.cell(r, 15, f'=IF({mine},$C{r}="{AI}"),MAX(O$1:O{r - 1})+1,"")')
        svc.cell(r, 16, f'=IF({mine},OR($C{r}="{RCS}",$C{r}="{VOICE}")),MAX(P$1:P{r - 1})+1,"")')
        svc.cell(r, 17, f'=IF($A{r}="","",TEXT($A{r},"0")&"|"&$C{r})')
    for c in 'NOPQ':
        svc.column_dimensions[c].hidden = True

    def listed(ws, r, n_col, first):
        """The nth customer who has the service (the row's position in the list), or "" when there are fewer."""
        pos = f'ROWS(A${first}:A{r})'
        return f"IFERROR(INDEX('2 Services'!$A$2:$A${LAST},MATCH({pos},'2 Services'!${n_col}$2:${n_col}${LAST},0)),\"\")"

    def from_key(r, key_service, col):
        """A cell of the customer's "2 Services" row for this service ("" when there is none or it is empty). key_service is a formula part."""
        x = f"INDEX('2 Services'!${col}$2:${col}${LAST},MATCH(TEXT($A{r},\"0\")&\"|\"&{key_service},'2 Services'!$Q$2:$Q${LAST},0))"
        return f'IFERROR(IF({x}&""="","",{x}),"")'

    # ---- 3 WhatsApp Account ---------------------------------------------------------------------------------------------------
    ws = wb['3 WhatsApp Account']
    insert_column(ws, 2, ws.max_row)
    # A mobile, B customer, C api number, D waba, E display, F blue, G quality, H limit, I package, J in package, K extra, L sent ... T subs ends, U data as of
    customer_cell(ws, 2, 3, ws.max_row)
    for r in range(4, ws.max_row + 1):
        ws.cell(r, 1).value = f'={listed(ws, r, "N", 4)}'
        ws.cell(r, 1).number_format = '@'
        ws.cell(r, 5).value = f'=IF($A{r}="","",IFERROR(INDEX(\'1 Customers\'!$C$2:$C${LAST},{lookup_index(f"TEXT($A{r},\"0\")")})&"",""))'
        ws.cell(r, 10).value = f'=IF(I{r}="","",IFERROR(IF(VLOOKUP(I{r},Lists!$C$1:$D$6,2,FALSE)=0,"",VLOOKUP(I{r},Lists!$C$1:$D$6,2,FALSE)),""))'
        ws.cell(r, 20).value = f'=IF($A{r}="","",{from_key(r, '"' + WA + '"', "H")})'
        ws.cell(r, 21).value = f'=IF(OR($A{r}="",{set_once_asof}=""),"",{set_once_asof})'
        for c in (1, 5, 10, 20, 21):
            ws.cell(r, c).fill = AUTO_FILL
    for r in range(3, ws.max_row + 1):
        # "% Used": the package size is now a formula that gives "" until a package is chosen, so ask before adding
        ws.cell(r, 18).value = f'=IF(J{r}="","",IF(J{r}+N(K{r})=0,"",N(L{r})/(J{r}+N(K{r}))))'
    drop_dv(ws, 'I')
    add_dv(ws, DataValidation(type='list', formula1='=Lists!$C$1:$C$6', allow_blank=True, showErrorMessage=True, error='Pick a package from the list.')).add(f'I3:I{ws.max_row}')

    # ---- 4 WhatsApp Campaigns: mobile from the customers --------------------------------------------------------------------------
    ws = wb['4 WhatsApp Campaigns']
    insert_column(ws, 2, ws.max_row)
    customer_cell(ws, 2, 3, ws.max_row)
    drop_dv(ws, 'A')
    add_dv(ws, DataValidation(type='list', formula1=f"='1 Customers'!$A$2:$A${LAST}", allow_blank=True, showErrorMessage=True, errorStyle='warning',
                              errorTitle='Mobile number', error='This mobile number is not in "1 Customers".')).add(f'A3:A{ws.max_row}')

    # ---- 5 AI Calling ---------------------------------------------------------------------------------------------------------------
    ws = wb['5 AI Calling']
    insert_column(ws, 2, ws.max_row)
    # A mobile, B customer, C platform, D plan, E numbers, F agent, G cr bought, H cr left, I min bought, J min left, K min used, ... R valid until, S data as of
    customer_cell(ws, 2, 3, ws.max_row)
    for r in range(4, ws.max_row + 1):
        ws.cell(r, 1).value = f'={listed(ws, r, "O", 4)}'
        ws.cell(r, 1).number_format = '@'
        ws.cell(r, 3).value = f'=IF($A{r}="","","Bolify AI")'
        ws.cell(r, 18).value = f'=IF($A{r}="","",{from_key(r, '"' + AI + '"', "H")})'
        ws.cell(r, 19).value = f'=IF(OR($A{r}="",{set_once_asof}=""),"",{set_once_asof})'
        for c in (1, 3, 18, 19):
            ws.cell(r, c).fill = AUTO_FILL

    # ---- 6 RCS & Voice ------------------------------------------------------------------------------------------------------------
    ws = wb['6 RCS & Voice']
    insert_column(ws, 2, ws.max_row)
    # A mobile, B customer, C service, D sender, E package, F sent ... M valid until, N data as of
    customer_cell(ws, 2, 3, ws.max_row)
    for r in range(4, ws.max_row + 1):
        ws.cell(r, 1).value = f'={listed(ws, r, "P", 4)}'
        ws.cell(r, 1).number_format = '@'
        pos = f'ROWS(A$4:A{r})'
        ws.cell(r, 3).value = f"=IF($A{r}=\"\",\"\",IFERROR(INDEX('2 Services'!$C$2:$C${LAST},MATCH({pos},'2 Services'!$P$2:$P${LAST},0)),\"\"))"
        ws.cell(r, 13).value = f'=IF($A{r}="","",{from_key(r, f"$C{r}", "H")})'
        ws.cell(r, 14).value = f'=IF(OR($A{r}="",{set_once_asof}=""),"",{set_once_asof})'
        for c in (1, 3, 13, 14):
            ws.cell(r, c).fill = AUTO_FILL

    # ---- 7 Monthly Deliverables ---------------------------------------------------------------------------------------------------
    ws = wb['7 Monthly Deliverables']
    insert_column(ws, 2, ws.max_row)
    # A mobile, B customer, C service, D month, E unit, F included, G delivered, H pending ...
    customer_cell(ws, 2, 3, ws.max_row)
    drop_dv(ws, 'A')
    add_dv(ws, DataValidation(type='list', formula1=f"='1 Customers'!$A$2:$A${LAST}", allow_blank=True, showErrorMessage=True, errorStyle='warning',
                              errorTitle='Mobile number', error='This mobile number is not in "1 Customers".')).add(f'A3:A{ws.max_row}')
    for r in range(4, ws.max_row + 1):
        ws.cell(r, 5).value = f'=IF(C{r}="","",IFERROR(VLOOKUP(C{r},Lists!$H$1:$I$30,2,FALSE),""))'
        ws.cell(r, 5).fill = AUTO_FILL

    # ---- How to fill: say it ------------------------------------------------------------------------------------------------------
    how = wb['How to fill']
    r0 = how.max_row + 2
    how.cell(r0, 1, 'What fills itself (new)').font = Font(bold=True)
    for i, t in enumerate([
        'Open the "Set once" tab first: type "Data as of" (and the Support Team Member) once.',
        'Type each customer\'s mobile number once, in "1 Customers". In the other sheets pick it from the drop-down; "Customer (auto)" shows the name (red = not in sheet 1).',
        'Sheets 3, 5 and 6 list the customers who have WhatsApp / AI Calling / RCS or Voice in "2 Services" - just type their numbers on the row. A row with no numbers typed is skipped.',
        'Light-green cells fill themselves (renewal date, panel, display name, package size, subscription end, unit). Type over one when it is wrong.',
        'Client Password (1 Customers, optional): the password you choose for the client, at least 10 characters. The client is e-mailed the dashboard address, login e-mail and password; the CRM keeps only a hash. Delete the column or the file after the import.',
    ], start=r0 + 1):
        how.cell(i, 1, t).alignment = Alignment(wrap_text=True, vertical='top')

    for r in range(1, how.max_row + 1):
        v = how.cell(r, 1).value
        if isinstance(v, str) and v.startswith('6. NEVER write passwords'):
            how.cell(r, 1).value = ('6. NEVER write a panel password. Only the panel login e-mail / account ID. The one password that is allowed is the optional '
                                    '"Client Password" in 1 Customers (the password the client signs in to the CRM with).')
    wb.save(path)
    print(f'{path.name}: done')


if __name__ == '__main__':
    for p in TEMPLATES:
        if not p.exists():
            sys.exit(f'missing {p}')
        build(p)
