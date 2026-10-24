#!/usr/bin/env python3
"""
Builds public/templates/Existing_Customers_One_Sheet.xlsx: the existing-customer import on ONE plain tab ("Import").

One row per record. The first column ("Record type") says what the row is: Customer, Service, WhatsApp account, WhatsApp campaign,
AI Calling, RCS / Voice or Monthly deliverable. The mobile number links the rows of one customer. Nothing is calculated or filled in by
the sheet: no formulas, no hidden columns; the person types what they know. Drop-downs help where the answer is a short list, and a small
line above every heading says which kinds of row use the column.

A Customer row says who looks after the customer (Support Team Member) and who brought them (Sales or Support, and the person).
The whole Support team can type into the same file; the Team Lead / Department Head uploads it once.

The column headings must match ONE_SHEET_TYPES in src/lib/existingCustomerImport.ts (the import reads the sheet by its headings).

    python3 scripts/build_one_sheet_template.py
"""
import copy
from pathlib import Path

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/templates/Existing_Customers_One_Sheet.xlsx'
SOURCE = ROOT / 'public/templates/Existing_Customers_Services_Usage_Team.xlsx'  # for the Metrics Guide, the service list and the Support Team tab

HEADER = 2                   # row of the headings (row 1 says which kinds of row use each column)
EXAMPLES = range(3, 10)      # the grey example rows
FIRST, LAST = 10, 3009       # data rows

TYPES = ['Customer', 'Service', 'WhatsApp account', 'WhatsApp campaign', 'AI Calling', 'RCS / Voice', 'Monthly deliverable']
T, S, W, C, A, R, M = TYPES
ALL = set(TYPES)
SHORT = {T: 'Customer', S: 'Service', W: 'WhatsApp account', C: 'Campaign', A: 'AI Calling', R: 'RCS / Voice', M: 'Monthly'}
GROUP_COLOR = {'core': '0E5A53', T: '0E5A53', S: '1F5F96', W: '2F6B1F', C: '4C8B2B', A: '6B3FA0', R: 'A15C07', M: '3B6E8F', 'shared': '3F4A57'}
WA_SERVICE = 'WhatsApp API + Blue Tick'

# (heading, used by, colour group, width, kind)    kind: text | mobile | date | num | int | password
COLUMNS = [
    ('Record type *', ALL, 'core', 20, 'text'),
    ('Mobile Number *', ALL, 'core', 17, 'mobile'),
    # Customer
    ('Customer Name *', {T}, T, 20, 'text'), ('Business Name *', {T}, T, 26, 'text'), ('E-mail', {T}, T, 26, 'text'), ('City', {T}, T, 14, 'text'),
    ('Business Address', {T}, T, 34, 'text'), ('Business Category', {T}, T, 18, 'text'), ('Customer Since', {T}, T, 15, 'date'),
    ('Handled by - Support Team Member *', {T}, T, 24, 'text'), ('Brought by (Sales / Support)', {T}, T, 16, 'text'), ('Brought by - Name', {T}, T, 22, 'text'),
    ('Client Login E-mail', {T}, T, 26, 'text'), ('Client Password', {T}, T, 20, 'password'),
    # Service
    ('Service *', {S, R, M}, S, 30, 'text'), ('Plan / Package Name', {S}, S, 22, 'text'), ('Price Paid (₹, excl. GST)', {S}, S, 16, 'num'),
    ('Billing Cycle', {S}, S, 14, 'text'), ('Start Date *', {S}, S, 14, 'date'), ('Renewal / Expiry Date', {S}, S, 16, 'date'),
    ('Status *', {S}, S, 13, 'text'), ('Panel / Platform', {S, A}, S, 28, 'text'), ('Panel Login E-mail / Account ID', {S}, S, 28, 'text'),
    # WhatsApp account
    ('WhatsApp API Number', {W}, W, 17, 'mobile'), ('WABA ID', {W}, W, 19, 'mobile'), ('Display Name', {W}, W, 22, 'text'), ('Blue Tick', {W}, W, 11, 'text'),
    ('Quality Rating', {W}, W, 15, 'text'), ('Messaging Limit', {W}, W, 14, 'text'), ('Message Package', {W}, W, 14, 'text'),
    ('Messages in Package *', {W, R}, W, 16, 'int'), ('Extra Messages Added', {W}, W, 14, 'int'),
    # shared usage
    ('Sent *', {W, C, R}, 'shared', 12, 'int'), ('Delivered', {W, C, R, M}, 'shared', 12, 'int'), ('Read / Answered', {W, C, R}, 'shared', 14, 'int'),
    ('Replied', {W, C}, 'shared', 11, 'int'), ('Failed', {W, C, R}, 'shared', 11, 'int'),
    ('Campaigns Sent / Run', {W, A, R}, 'shared', 13, 'int'), ('Valid Until', {W, A, R}, 'shared', 14, 'date'), ('Data as of *', {W, A, R}, 'shared', 14, 'date'),
    # Campaign
    ('Campaign Name *', {C}, C, 24, 'text'), ('Template Name', {C}, C, 18, 'text'), ('Sent On *', {C}, C, 14, 'date'), ('Audience Type', {C}, C, 16, 'text'),
    ('Audience Size *', {C}, C, 13, 'int'), ('Campaign Status', {C}, C, 14, 'text'),
    # AI Calling
    ('Calling Plan *', {A}, A, 20, 'text'), ('Calling Number(s)', {A}, A, 18, 'mobile'), ('AI Agent Name', {A}, A, 18, 'text'), ('Credits Bought (₹)', {A}, A, 14, 'num'),
    ('Credits Left (₹)', {A}, A, 14, 'num'), ('Minutes Bought', {A}, A, 13, 'int'), ('Minutes Left', {A}, A, 12, 'int'),
    ('Total Calls', {A}, A, 11, 'int'), ('Connected Calls', {A}, A, 12, 'int'), ('Not Answered', {A}, A, 12, 'int'), ('Interested / Leads', {A}, A, 12, 'int'),
    ('Contacts Uploaded', {A}, A, 12, 'int'),
    # RCS / Voice
    ('Sender ID / Brand Name', {R}, R, 22, 'text'), ('Clicks / Key-press Replies', {R}, R, 14, 'int'),
    # Monthly
    ('Month *', {M}, M, 11, 'text'), ('What is delivered (unit) *', {M}, M, 22, 'text'), ('Included in Plan', {M}, M, 12, 'int'),
    ('Result 1 - name', {M}, M, 16, 'text'), ('Result 1 - value', {M}, M, 14, 'text'), ('Result 2 - name', {M}, M, 16, 'text'), ('Result 2 - value', {M}, M, 14, 'text'),
    ('Link (page / profile / website)', {M}, M, 28, 'text'),
    ('Notes', {T, S, M}, 'shared', 30, 'text'),
]

EXAMPLE_FILL = PatternFill('solid', fgColor='F2F2F2')
NOTE_FONT = Font(italic=True, size=9, color='555555')


def used_by(ap):
    if ap == ALL:
        return 'every row'
    return ' / '.join(SHORT[t] for t in TYPES if t in ap)


def copy_sheet(src_ws, dst_ws):
    for row in src_ws.iter_rows():
        for c in row:
            if c.value is not None:
                d = dst_ws.cell(c.row, c.column, c.value)
                d.font, d.fill, d.alignment = copy.copy(c.font), copy.copy(c.fill), copy.copy(c.alignment)
    for k, dim in src_ws.column_dimensions.items():
        dst_ws.column_dimensions[k].width = dim.width


def build():
    src = openpyxl.load_workbook(SOURCE)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    col = {c[0]: i + 1 for i, c in enumerate(COLUMNS)}
    cl = {name: L(i) for name, i in col.items()}
    n = len(COLUMNS)

    # ---- How to fill ----------------------------------------------------------------------------------------------------------------
    how = wb.create_sheet('How to fill')
    how.column_dimensions['A'].width = 28
    how.column_dimensions['B'].width = 112
    how['A1'] = 'Existing customers - everything on one sheet'
    how['A1'].font = Font(bold=True, size=14)
    lines = [
        ('', 'The whole Support team fills the "Import" tab of this ONE file. The Team Lead / Department Head uploads it once in the CRM (Import existing customers). Nothing in the file is calculated: you type what you know.'),
        ('', 'Every row is one record. The first column, Record type, says which kind. The small line above every heading says which kinds of row use that column.'),
        ('', ''),
        ('Rules', ''),
        ('1', 'The Mobile Number links every row of one customer (10 digits, no +91, no spaces). Type the same number on the Customer row and on every row that belongs to that customer.'),
        ('2', 'The order of the rows does not matter. Rows 3 to 9 are grey EXAMPLES: leave or delete them, the import skips them. Start your own rows on row 10.'),
        ('3', 'Columns marked * are required for the kinds of row that use them (see the table below). Use the drop-downs where there is one. Numbers without commas (100000, not 1,00,000). Dates as DD-MM-YYYY.'),
        ('4', 'NEVER write a panel password. Only the panel login e-mail / account ID. The one password that is allowed is the optional "Client Password" on a Customer row.'),
        ('', ''),
        ('Who is on the Customer row', ''),
        ('Handled by', 'The Support Team Member (or Team Lead) who looks after the customer. Pick the name from the Support Team tab list (the Team Lead / Department Head must name them; a Team Member who uploads always gets the customers for themselves).'),
        ('Brought by', 'Who brought the customer: choose Sales or Support, and write the person\'s name as it is in the CRM (or their CRM e-mail). Either one is enough: "Sales" alone, or just the name. Leave both empty when it is not known. Used for department-wise income. Only a new customer gets it; one that already exists keeps what it has.'),
        ('', ''),
        ('Record types', ''),
        (T, 'One row per customer. Required: Mobile, Customer Name, Business Name, Handled by.'),
        (S, 'One row per service a customer bought (3 services = 3 rows). Required: Mobile, Service, Start Date, Status.'),
        (W, 'One row per WhatsApp API customer: package, messages used, quality. Required: Mobile, Messages in Package, Sent, Data as of. If the customer has no WhatsApp API service row, it is added.'),
        (C, 'One row per WhatsApp campaign. Required: Mobile, Campaign Name, Sent On, Audience Size, Sent, Delivered. Last 3 months is enough.'),
        (A, 'One row per AI Calling customer (from Bolify AI). Required: Mobile, Calling Plan, Data as of.'),
        (R, 'One row per RCS or Voice (Bulk) customer: choose the Service. Required: Mobile, Service, Messages in Package, Sent.'),
        (M, 'One row per customer, service and month for all other services (posts, reels, leads ...). Required: Mobile, Service, Month (like Oct-2026), unit.'),
        ('', ''),
        ('Client Password', 'Optional, on a Customer row: the password the client signs in with (10+ characters). The client is e-mailed the dashboard address, login e-mail and password once; the CRM keeps only a hash. Delete the column or the file after the import.'),
        ('Where to read the numbers', 'WhatsApp: Wabastore panel > CRM > Campaigns > Campaign Overview > Quick Report. AI Calling: Bolify AI > Dashboard, Call Logs. See the Metrics Guide tab for every service.'),
    ]
    for i, (a, b) in enumerate(lines, start=3):
        how.cell(i, 1, a).font = Font(bold=True)
        how.cell(i, 2, b).alignment = Alignment(wrap_text=True, vertical='top')
        how.cell(i, 1).alignment = Alignment(vertical='top')

    # ---- the Import tab -------------------------------------------------------------------------------------------------------------
    ws = wb.create_sheet('Import')
    ws.sheet_properties.tabColor = '0E5A53'
    for name, i in col.items():
        ap, grp, width, kind = next((ap, g, w, k) for h, ap, g, w, k in COLUMNS if h == name)
        u = ws.cell(1, i, f'Used by: {used_by(ap)}')
        u.font, u.alignment = NOTE_FONT, Alignment(wrap_text=True, vertical='bottom')
        c = ws.cell(HEADER, i, name)
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor=GROUP_COLOR[grp])
        c.alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[L(i)].width = width
        fmt = {'mobile': '@', 'password': '@', 'date': 'DD-MM-YYYY', 'num': '#,##0.00', 'int': '#,##0'}.get(kind)
        if fmt:
            ws.column_dimensions[L(i)].number_format = fmt
    ws.row_dimensions[1].height = 30
    ws.row_dimensions[HEADER].height = 46
    ws.freeze_panes = f'C{HEADER + 1}'
    ws.auto_filter.ref = f'A{HEADER}:{L(n)}{LAST}'
    ws.cell(HEADER, col['Record type *']).comment = Comment(
        'Choose what this row is: Customer, Service, WhatsApp account, WhatsApp campaign, AI Calling, RCS / Voice or Monthly deliverable.', 'CRM')
    ws.cell(HEADER, col['Brought by (Sales / Support)']).comment = Comment(
        'Who brought the customer: Sales or Support. Together with (or instead of) the name on the right. Leave empty when it is not known.', 'CRM')
    ws.cell(HEADER, col['Brought by - Name']).comment = Comment(
        'The person who brought the customer, written as in the CRM (or their CRM e-mail). Their team decides Sales or Support, so the two must agree.', 'CRM')
    ws.cell(HEADER, col['Client Password']).comment = Comment(
        'Optional. The password the client signs in with (at least 10 characters). The client is e-mailed their dashboard address, login e-mail and this '
        'password once; the CRM keeps only the hash. Leave empty to let the client choose their own from an e-mail. Delete this column or the file once the import is done.', 'CRM')

    # ---- examples -----------------------------------------------------------------------------------------------------------------------
    EX = {
        T: {'Mobile Number *': '9820011111', 'Customer Name *': 'Siddhesh Patil', 'Business Name *': 'Galaxy Jewellers', 'E-mail': 'galaxy@example.com', 'City': 'Thane',
            'Business Address': 'Shop 4, Station Road, Thane', 'Business Category': 'Jewellery', 'Customer Since': '15-04-2025',
            'Handled by - Support Team Member *': '(pick from the list)', 'Brought by (Sales / Support)': 'Sales', 'Brought by - Name': 'Rahul Mehta',
            'Client Login E-mail': 'galaxy@example.com', 'Client Password': '(optional)'},
        S: {'Mobile Number *': '9820011111', 'Service *': WA_SERVICE, 'Plan / Package Name': '1 Lakh messages', 'Price Paid (₹, excl. GST)': 15000, 'Billing Cycle': 'Yearly',
            'Start Date *': '15-04-2025', 'Renewal / Expiry Date': '14-04-2026', 'Status *': 'Live', 'Panel / Platform': 'Wabastore (chat.wabastore.shop)'},
        W: {'Mobile Number *': '9820011111', 'WhatsApp API Number': '9820011112', 'WABA ID': '123456789012345', 'Display Name': 'Galaxy Jewellers', 'Blue Tick': 'Yes',
            'Quality Rating': 'High (Green)', 'Messaging Limit': '1K / day', 'Message Package': '1 Lakh', 'Messages in Package *': 100000, 'Sent *': 28000, 'Delivered': 25800,
            'Read / Answered': 11760, 'Replied': 840, 'Failed': 2200, 'Valid Until': '14-04-2026', 'Data as of *': '16-10-2026'},
        C: {'Mobile Number *': '9820011111', 'Campaign Name *': 'Diwali offer', 'Template Name': 'diwali_offer', 'Sent On *': '20-10-2026', 'Audience Type': 'Segmented',
            'Audience Size *': 4000, 'Sent *': 3500, 'Delivered': 3200, 'Read / Answered': 2500, 'Replied': 100, 'Failed': 300, 'Campaign Status': 'Completed'},
        A: {'Mobile Number *': '9820011111', 'Panel / Platform': 'Bolify AI', 'Calling Plan *': 'Credit-based', 'AI Agent Name': 'Riya', 'Credits Bought (₹)': 5000,
            'Credits Left (₹)': 3200, 'Minutes Bought': 1000, 'Minutes Left': 640, 'Total Calls': 410, 'Connected Calls': 260, 'Not Answered': 150, 'Interested / Leads': 31,
            'Data as of *': '16-10-2026'},
        R: {'Mobile Number *': '9820011111', 'Service *': 'RCS Registration + Platform', 'Sender ID / Brand Name': 'Galaxy Jewellers', 'Messages in Package *': 50000, 'Sent *': 12000,
            'Delivered': 11300, 'Read / Answered': 6100, 'Clicks / Key-press Replies': 420, 'Failed': 700, 'Data as of *': '16-10-2026'},
        M: {'Mobile Number *': '9820011111', 'Service *': 'Social Media Management', 'Month *': 'Oct-2026', 'What is delivered (unit) *': 'Posts', 'Included in Plan': 12,
            'Delivered': 8, 'Result 1 - name': 'Reach', 'Result 1 - value': '12,400'},
    }
    for i, t in enumerate(TYPES):
        r = EXAMPLES[i]
        ws.cell(r, 1, t)
        for h, v in EX[t].items():
            ws.cell(r, col[h], v)
        ws.cell(r, col['Notes'], 'EXAMPLE - delete')
        for c in range(1, n + 1):
            ws.cell(r, c).fill = EXAMPLE_FILL
            ws.cell(r, c).font = Font(italic=True, color='555555')

    # ---- the other tabs ---------------------------------------------------------------------------------------------------------------------
    team = wb.create_sheet('Support Team')
    copy_sheet(src['Support Team'], team)
    team.freeze_panes = 'A2'
    guide = wb.create_sheet('Metrics Guide')
    copy_sheet(src['8 Metrics Guide'], guide)
    guide.freeze_panes = 'B2'
    lists = wb.create_sheet('Lists')
    for i in range(1, 16):
        lists.cell(i, 1, src['Lists'].cell(i, 1).value)
    for i, label in enumerate(['50,000', '1 Lakh', '2 Lakh', '5 Lakh', '10 Lakh', 'Custom'], start=1):
        lists.cell(i, 3, label)
    for i, p in enumerate(['Wabastore (chat.wabastore.shop)', 'Whatsbox(app.whatsbox.shop)', 'Bolify AI', 'Crocodile', 'Meta Business Suite', 'Google', 'Other'], start=1):
        lists.cell(i, 5, p)
    for i, t in enumerate(TYPES, start=1):
        lists.cell(i, 10, t)
    lists.sheet_state = 'hidden'

    # ---- drop-downs (they only help: nothing is filled in for the person) -----------------------------------------------------------------------
    def add_dv(dv, name):
        ws.add_data_validation(dv)
        dv.add(f'{cl[name]}{FIRST}:{cl[name]}{LAST}')

    add_dv(DataValidation(type='list', formula1='=Lists!$J$1:$J$7', allow_blank=True, showErrorMessage=True, error='Pick the kind of row from the list.'), 'Record type *')
    add_dv(DataValidation(type='list', formula1="='Support Team'!$A$2:$A$200", allow_blank=True, showErrorMessage=True, errorStyle='warning',
                          error='This name is not on the Support Team tab.'), 'Handled by - Support Team Member *')
    add_dv(DataValidation(type='list', formula1='"Sales,Support"', allow_blank=True, showErrorMessage=True, error='Choose Sales or Support.'), 'Brought by (Sales / Support)')
    add_dv(DataValidation(type='textLength', operator='greaterThanOrEqual', formula1='10', allow_blank=True, showErrorMessage=True, errorStyle='warning',
                          errorTitle='Client Password', error='Use at least 10 characters.'), 'Client Password')
    add_dv(DataValidation(type='list', formula1='=Lists!$A$1:$A$15', allow_blank=True, showErrorMessage=True, errorStyle='warning', error='Pick a service from the list.'), 'Service *')
    add_dv(DataValidation(type='list', formula1='"Monthly,Quarterly,Half-yearly,Yearly,One-time"', allow_blank=True, showErrorMessage=True), 'Billing Cycle')
    add_dv(DataValidation(type='list', formula1='"Live,Setting up,Paused,Expired,Cancelled"', allow_blank=True, showErrorMessage=True), 'Status *')
    add_dv(DataValidation(type='list', formula1='=Lists!$E$1:$E$7', allow_blank=True, showErrorMessage=True, errorStyle='warning', error='Pick a panel from the list, or keep what you typed.'), 'Panel / Platform')
    add_dv(DataValidation(type='list', formula1='"Yes,No,Applied"', allow_blank=True, showErrorMessage=True), 'Blue Tick')
    add_dv(DataValidation(type='list', formula1='"High (Green),Medium (Yellow),Low (Red),Not known"', allow_blank=True, showErrorMessage=True), 'Quality Rating')
    add_dv(DataValidation(type='list', formula1='"250 / day,1K / day,10K / day,100K / day,Unlimited,Not known"', allow_blank=True, showErrorMessage=True), 'Messaging Limit')
    add_dv(DataValidation(type='list', formula1='=Lists!$C$1:$C$6', allow_blank=True, showErrorMessage=True), 'Message Package')
    add_dv(DataValidation(type='list', formula1='"All contacts,Segmented,Uploaded list"', allow_blank=True, showErrorMessage=True), 'Audience Type')
    add_dv(DataValidation(type='list', formula1='"Completed,Running,Scheduled,Paused,Failed"', allow_blank=True, showErrorMessage=True), 'Campaign Status')
    add_dv(DataValidation(type='list', formula1='"Credit-based,Unlimited monthly"', allow_blank=True, showErrorMessage=True), 'Calling Plan *')
    for name in col:
        kind = next(k for h, ap, g, w, k in COLUMNS if h == name)
        if kind == 'date':
            add_dv(DataValidation(type='date', operator='greaterThan', formula1='DATE(2018,1,1)', allow_blank=True, showErrorMessage=True, error='Type the date as DD-MM-YYYY.'), name)
        elif kind in ('int', 'num'):
            add_dv(DataValidation(type='decimal', operator='greaterThanOrEqual', formula1='0', allow_blank=True, showErrorMessage=True, error='Type a number (no commas).'), name)

    wb._sheets = [wb[n_] for n_ in ['How to fill', 'Import', 'Support Team', 'Metrics Guide', 'Lists']]
    wb.active = 1
    wb.save(OUT)
    print(f'{OUT.name}: {n} columns, rows {FIRST}-{LAST}')


if __name__ == '__main__':
    build()
