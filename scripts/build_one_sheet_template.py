#!/usr/bin/env python3
"""
Builds public/templates/Existing_Customers_One_Sheet.xlsx: the existing-customer import on ONE plain tab ("Import").

ONE table. A row is a customer and one service they bought (more rows for the campaigns and the months of that service). There is no
"record type": the columns are grouped in coloured blocks - CUSTOMER, SERVICE BOUGHT, WHATSAPP API, WHATSAPP CAMPAIGN, AI CALLING,
RCS / VOICE, MONTHLY WORK - and what a row holds is read from the blocks that are filled in. The customer's details are typed once, on
the customer's first row; every other row of that customer carries just the mobile number and its service. Nothing is calculated or
filled in by the sheet: no formulas, no hidden columns; drop-downs only help where the answer is a short list.

A customer says who looks after them (Support Team Member) and who brought them (Sales or Support, and the person).
The whole Support team can type into the same file; the Team Lead / Department Head uploads it once.

The column headings must match ONE_SHEET_BLOCKS in src/lib/existingCustomerImport.ts (the import reads the sheet by its headings).

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

BLOCK_ROW, HEADER = 1, 2     # row 1: the name of each block; row 2: the headings
EXAMPLES = range(3, 8)       # the grey example rows
FIRST, LAST = 8, 3007        # data rows

WA_SERVICE = 'WhatsApp API + Blue Tick'

# (block, colour, [(heading, width, kind)])   kind: text | mobile | date | num | int | password
BLOCKS = [
    ('EVERY ROW', '0E5A53', [('Mobile Number *', 17, 'mobile')]),
    ('CUSTOMER - typed once, on the customer\'s first row', '0E5A53', [
        ('Customer Name *', 20, 'text'), ('Business Name *', 26, 'text'), ('E-mail', 26, 'text'), ('City', 14, 'text'), ('Business Address', 34, 'text'),
        ('Business Category', 18, 'text'), ('Customer Since', 15, 'date'), ('Handled by - Support Team Member *', 24, 'text'),
        ('Brought by (Sales / Support)', 16, 'text'), ('Brought by - Name', 22, 'text'), ('Client Login E-mail', 26, 'text'), ('Client Password', 20, 'password'),
        ('Customer Notes', 26, 'text')]),
    ('SERVICE BOUGHT - one row per service', '1F5F96', [
        ('Service *', 30, 'text'), ('Plan / Package Name', 22, 'text'), ('Price Paid (₹, excl. GST)', 16, 'num'), ('Billing Cycle', 14, 'text'),
        ('Start Date *', 14, 'date'), ('Renewal / Expiry Date', 16, 'date'), ('Status *', 13, 'text'), ('Panel / Platform', 28, 'text'),
        ('Panel Login E-mail / Account ID', 28, 'text'), ('Service Notes', 22, 'text')]),
    ('WHATSAPP API - the account', '2F6B1F', [
        ('WhatsApp API Number', 17, 'mobile'), ('WABA ID', 19, 'mobile'), ('Display Name', 22, 'text'), ('Blue Tick', 11, 'text'), ('Quality Rating', 15, 'text'),
        ('Messaging Limit', 14, 'text'), ('Message Package', 14, 'text'), ('Messages in Package *', 16, 'int'), ('Extra Messages Added', 14, 'int'),
        ('Messages Sent (total) *', 14, 'int'), ('Messages Delivered (total)', 14, 'int'), ('Messages Read (total)', 14, 'int'), ('Replies (total)', 12, 'int'),
        ('Failed (total)', 12, 'int'), ('Campaigns Sent (total)', 13, 'int'), ('Subscription Ends', 14, 'date'), ('WhatsApp Data as of *', 14, 'date')]),
    ('WHATSAPP CAMPAIGN - one row per campaign', '4C8B2B', [
        ('Campaign Name *', 24, 'text'), ('Template Name', 18, 'text'), ('Sent On *', 14, 'date'), ('Audience Type', 16, 'text'), ('Audience Size *', 13, 'int'),
        ('Campaign Sent *', 12, 'int'), ('Campaign Delivered *', 12, 'int'), ('Campaign Read', 12, 'int'), ('Campaign Replied', 12, 'int'), ('Campaign Failed', 12, 'int'),
        ('Campaign Status', 14, 'text')]),
    ('AI CALLING', '6B3FA0', [
        ('AI Platform', 16, 'text'), ('Calling Plan *', 20, 'text'), ('Calling Number(s)', 18, 'mobile'), ('AI Agent Name', 18, 'text'), ('Credits Bought (₹)', 14, 'num'),
        ('Credits Left (₹)', 14, 'num'), ('Minutes Bought', 13, 'int'), ('Minutes Left', 12, 'int'), ('Total Calls', 11, 'int'), ('Connected Calls', 12, 'int'),
        ('Not Answered', 12, 'int'), ('Interested / Leads', 12, 'int'), ('AI Campaigns Run', 12, 'int'), ('Contacts Uploaded', 12, 'int'),
        ('AI Plan Valid Until', 14, 'date'), ('AI Data as of *', 14, 'date')]),
    ('RCS / VOICE', 'A15C07', [
        ('Sender ID / Brand Name', 22, 'text'), ('RCS / Voice Messages in Package *', 16, 'int'), ('RCS / Voice Sent *', 12, 'int'), ('RCS / Voice Delivered', 12, 'int'),
        ('RCS Read / Voice Answered', 14, 'int'), ('RCS Clicks / Voice Key-press Replies', 15, 'int'), ('RCS / Voice Failed', 12, 'int'),
        ('RCS / Voice Campaigns Run', 12, 'int'), ('RCS / Voice Valid Until', 14, 'date'), ('RCS / Voice Data as of', 14, 'date')]),
    ('MONTHLY WORK - one row per month, for the other services', '3B6E8F', [
        ('Month *', 11, 'text'), ('What is delivered (unit) *', 22, 'text'), ('Included in Plan', 12, 'int'), ('Delivered This Month', 12, 'int'),
        ('Result 1 - name', 16, 'text'), ('Result 1 - value', 14, 'text'), ('Result 2 - name', 16, 'text'), ('Result 2 - value', 14, 'text'),
        ('Link (page / profile / website)', 28, 'text'), ('Monthly Notes', 22, 'text')]),
]
COLUMNS = [(h, w, k, name, color) for name, color, cols in BLOCKS for h, w, k in cols]

EXAMPLE_FILL = PatternFill('solid', fgColor='F2F2F2')


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
        ('', 'A row is a customer and ONE service they bought. The coloured blocks at the top say what each group of columns is. Fill the blocks that apply to that service and leave the others empty.'),
        ('', ''),
        ('Rules', ''),
        ('1', 'The Mobile Number is on EVERY row: it links all the rows of one customer (10 digits, no +91, no spaces).'),
        ('2', 'The customer\'s details (name, business, who handles, who brought, client login) are typed ONCE, on the customer\'s first row. The other rows of that customer carry only the mobile number and the service.'),
        ('3', 'Rows 3 to 7 are grey EXAMPLES: leave or delete them, the import skips them. Start your own rows on row 8. The order of the rows does not matter.'),
        ('4', 'Columns marked * are required when you fill their block. Use the drop-downs where there is one. Numbers without commas (100000, not 1,00,000). Dates as DD-MM-YYYY.'),
        ('5', 'NEVER write a panel password. Only the panel login e-mail / account ID. The one password that is allowed is the optional "Client Password" in the CUSTOMER block.'),
        ('', ''),
        ('Which rows to add', ''),
        ('A customer with 1 service', 'One row: the customer block + the SERVICE BOUGHT block + the block of that service (WHATSAPP API, AI CALLING or RCS / VOICE) if it has usage numbers.'),
        ('Another service', 'A new row: the same mobile number, the Service, and its block. Leave the CUSTOMER block empty.'),
        ('WhatsApp campaigns', 'One row per campaign: the mobile number, Service = WhatsApp API + Blue Tick, and the WHATSAPP CAMPAIGN block. Last 3 months is enough.'),
        ('Other services (posts, reels, leads ...)', 'One row per month: the mobile number, the Service, and the MONTHLY WORK block (Month like Oct-2026).'),
        ('', ''),
        ('Who is in the CUSTOMER block', ''),
        ('Handled by', 'The Support Team Member (or Team Lead) who looks after the customer. Pick the name from the Support Team tab list (the Team Lead / Department Head must name them; a Team Member who uploads always gets the customers for themselves).'),
        ('Brought by', 'Who brought the customer: choose Sales or Support, and write the person\'s name as it is in the CRM (or their CRM e-mail). Either one is enough: "Sales" alone, or just the name. Leave both empty when it is not known. Used for department-wise income. Only a new customer gets it; one that already exists keeps what it has.'),
        ('Client Password', 'Optional: the password the client signs in with (10+ characters). The client is e-mailed the dashboard address, login e-mail and password once; the CRM keeps only a hash. Delete the column or the file after the import.'),
        ('', ''),
        ('Where to read the numbers', 'WhatsApp: Wabastore panel > CRM > Campaigns > Campaign Overview > Quick Report. AI Calling: Bolify AI > Dashboard, Call Logs. See the Metrics Guide tab for every service.'),
    ]
    for i, (a, b) in enumerate(lines, start=3):
        how.cell(i, 1, a).font = Font(bold=True)
        how.cell(i, 2, b).alignment = Alignment(wrap_text=True, vertical='top')
        how.cell(i, 1).alignment = Alignment(vertical='top', wrap_text=True)

    # ---- the Import tab ---------------------------------------------------------------------------------------------------------------
    ws = wb.create_sheet('Import')
    ws.sheet_properties.tabColor = '0E5A53'
    start = 1
    for name, color, cols in BLOCKS:
        end = start + len(cols) - 1
        c = ws.cell(BLOCK_ROW, start, name)
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor=color)
        c.alignment = Alignment(horizontal='left', vertical='center')
        for j in range(start, end + 1):
            ws.cell(BLOCK_ROW, j).fill = PatternFill('solid', fgColor=color)
        if end > start:
            ws.merge_cells(start_row=BLOCK_ROW, start_column=start, end_row=BLOCK_ROW, end_column=end)
        for h, w, kind in cols:
            i = col[h]
            hc = ws.cell(HEADER, i, h)
            hc.font = Font(bold=True, color='FFFFFF')
            hc.fill = PatternFill('solid', fgColor=color)
            hc.alignment = Alignment(wrap_text=True, vertical='center')
            ws.column_dimensions[L(i)].width = w
            fmt = {'mobile': '@', 'password': '@', 'date': 'DD-MM-YYYY', 'num': '#,##0.00', 'int': '#,##0'}.get(kind)
            if fmt:
                ws.column_dimensions[L(i)].number_format = fmt
        start = end + 1
    ws.row_dimensions[BLOCK_ROW].height = 24
    ws.row_dimensions[HEADER].height = 48
    ws.freeze_panes = f'B{HEADER + 1}'
    ws.auto_filter.ref = f'A{HEADER}:{L(n)}{LAST}'
    ws.cell(HEADER, col['Brought by (Sales / Support)']).comment = Comment(
        'Who brought the customer: Sales or Support. Together with (or instead of) the name on the right. Leave empty when it is not known.', 'CRM')
    ws.cell(HEADER, col['Brought by - Name']).comment = Comment(
        'The person who brought the customer, written as in the CRM (or their CRM e-mail). Their team decides Sales or Support, so the two must agree.', 'CRM')
    ws.cell(HEADER, col['Client Password']).comment = Comment(
        'Optional. The password the client signs in with (at least 10 characters). The client is e-mailed their dashboard address, login e-mail and this '
        'password once; the CRM keeps only the hash. Leave empty to let the client choose their own from an e-mail. Delete this column or the file once the import is done.', 'CRM')

    # ---- examples -----------------------------------------------------------------------------------------------------------------------
    M = '9820011111'
    customer = {'Customer Name *': 'Siddhesh Patil', 'Business Name *': 'Galaxy Jewellers', 'E-mail': 'galaxy@example.com', 'City': 'Thane', 'Business Address': 'Shop 4, Station Road, Thane',
                'Business Category': 'Jewellery', 'Customer Since': '15-04-2025', 'Handled by - Support Team Member *': '(pick from the list)', 'Brought by (Sales / Support)': 'Sales',
                'Brought by - Name': 'Rahul Mehta', 'Client Login E-mail': 'galaxy@example.com', 'Client Password': '(optional)', 'Customer Notes': 'EXAMPLE - delete'}
    EX = [
        {**customer, 'Mobile Number *': M, 'Service *': WA_SERVICE, 'Plan / Package Name': '1 Lakh messages', 'Price Paid (₹, excl. GST)': 15000, 'Billing Cycle': 'Yearly',
         'Start Date *': '15-04-2025', 'Renewal / Expiry Date': '14-04-2026', 'Status *': 'Live', 'Panel / Platform': 'Wabastore (chat.wabastore.shop)',
         'WhatsApp API Number': '9820011112', 'WABA ID': '123456789012345', 'Display Name': 'Galaxy Jewellers', 'Blue Tick': 'Yes', 'Quality Rating': 'High (Green)',
         'Messaging Limit': '1K / day', 'Message Package': '1 Lakh', 'Messages in Package *': 100000, 'Messages Sent (total) *': 28000, 'Messages Delivered (total)': 25800,
         'Messages Read (total)': 11760, 'Replies (total)': 840, 'Failed (total)': 2200, 'Subscription Ends': '14-04-2026', 'WhatsApp Data as of *': '16-10-2026'},
        {'Mobile Number *': M, 'Service *': WA_SERVICE, 'Campaign Name *': 'Diwali offer', 'Template Name': 'diwali_offer', 'Sent On *': '20-10-2026', 'Audience Type': 'Segmented',
         'Audience Size *': 4000, 'Campaign Sent *': 3500, 'Campaign Delivered *': 3200, 'Campaign Read': 2500, 'Campaign Replied': 100, 'Campaign Failed': 300,
         'Campaign Status': 'Completed', 'Service Notes': 'EXAMPLE - delete'},
        {'Mobile Number *': M, 'Service *': 'AI Calling', 'Billing Cycle': 'Quarterly', 'Start Date *': '01-09-2026', 'Renewal / Expiry Date': '30-11-2026', 'Status *': 'Live',
         'Panel / Platform': 'Bolify AI', 'AI Platform': 'Bolify AI', 'Calling Plan *': 'Credit-based', 'AI Agent Name': 'Riya', 'Credits Bought (₹)': 5000, 'Credits Left (₹)': 3200,
         'Minutes Bought': 1000, 'Minutes Left': 640, 'Total Calls': 410, 'Connected Calls': 260, 'Not Answered': 150, 'Interested / Leads': 31, 'AI Data as of *': '16-10-2026'},
        {'Mobile Number *': M, 'Service *': 'RCS Registration + Platform', 'Billing Cycle': 'Yearly', 'Start Date *': '01-06-2026', 'Status *': 'Live', 'Sender ID / Brand Name': 'Galaxy Jewellers',
         'RCS / Voice Messages in Package *': 50000, 'RCS / Voice Sent *': 12000, 'RCS / Voice Delivered': 11300, 'RCS Read / Voice Answered': 6100,
         'RCS Clicks / Voice Key-press Replies': 420, 'RCS / Voice Failed': 700, 'RCS / Voice Data as of': '16-10-2026'},
        {'Mobile Number *': M, 'Service *': 'Social Media Management', 'Billing Cycle': 'Monthly', 'Start Date *': '01-07-2026', 'Status *': 'Live', 'Month *': 'Oct-2026',
         'What is delivered (unit) *': 'Posts', 'Included in Plan': 12, 'Delivered This Month': 8, 'Result 1 - name': 'Reach', 'Result 1 - value': '12,400'},
    ]
    for r, values in zip(EXAMPLES, EX):
        for h, v in values.items():
            ws.cell(r, col[h], v)
        ws.cell(r, col['Monthly Notes'], 'EXAMPLE - delete')
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
    for i, p in enumerate(['Wabastore (chat.wabastore.shop)', 'Whatsbox(app.whatsbox.shop)', 'Bolify AI', 'Crocodial', 'Meta Business Suite', 'Google', 'Other'], start=1):
        lists.cell(i, 5, p)
    lists.sheet_state = 'hidden'

    # ---- drop-downs (they only help: nothing is filled in for the person) -----------------------------------------------------------------------
    def add_dv(dv, name):
        ws.add_data_validation(dv)
        dv.add(f'{cl[name]}{FIRST}:{cl[name]}{LAST}')

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
    add_dv(DataValidation(type='list', formula1='"Bolify AI,Other"', allow_blank=True, showErrorMessage=True, errorStyle='warning'), 'AI Platform')
    for h, w, kind, *_ in COLUMNS:
        if kind == 'date':
            add_dv(DataValidation(type='date', operator='greaterThan', formula1='DATE(2018,1,1)', allow_blank=True, showErrorMessage=True, error='Type the date as DD-MM-YYYY.'), h)
        elif kind in ('int', 'num'):
            add_dv(DataValidation(type='decimal', operator='greaterThanOrEqual', formula1='0', allow_blank=True, showErrorMessage=True, error='Type a number (no commas).'), h)

    wb._sheets = [wb[n_] for n_ in ['How to fill', 'Import', 'Support Team', 'Metrics Guide', 'Lists']]
    wb.active = 1
    wb.save(OUT)
    print(f'{OUT.name}: {n} columns, rows {FIRST}-{LAST}')


if __name__ == '__main__':
    build()
