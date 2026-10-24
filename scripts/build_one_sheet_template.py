#!/usr/bin/env python3
"""
Builds public/templates/Existing_Customers_One_Sheet.xlsx: the existing-customer import on ONE tab ("Import").

One row per record. The first column ("Record type") says what the row is: Customer, Service, WhatsApp account, WhatsApp campaign,
AI Calling, RCS / Voice or Monthly deliverable. Each kind uses only its own columns (the sheet greys out the others); columns that mean the
same thing in several kinds (Sent, Delivered, Valid Until, Data as of ...) are shared. The mobile number links the rows of one customer.
The whole Support team can type into the same file; the Team Lead / Department Head uploads it once.

The column headings must match ONE_SHEET_TYPES in src/lib/existingCustomerImport.ts (the import reads the sheet by its headings).

    python3 scripts/build_one_sheet_template.py
"""
import copy
from pathlib import Path

import openpyxl
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/templates/Existing_Customers_One_Sheet.xlsx'
SOURCE = ROOT / 'public/templates/Existing_Customers_Services_Usage_Team.xlsx'  # for the Metrics Guide, the service list and the Support Team tab

FIRST, LAST = 9, 3008  # data rows (rows 2-8 are the examples)
LOOKUP_LAST = LAST
CUSTOMERS_LISTED = 600

TYPES = ['Customer', 'Service', 'WhatsApp account', 'WhatsApp campaign', 'AI Calling', 'RCS / Voice', 'Monthly deliverable']
T, S, W, C, A, R, M = TYPES
ALL = set(TYPES)

GROUP_COLOR = {'core': '0E5A53', T: '0E5A53', S: '1F5F96', W: '2F6B1F', C: '4C8B2B', A: '6B3FA0', R: 'A15C07', M: '3B6E8F', 'shared': '3F4A57'}

WA_SERVICE, AI_SERVICE = 'WhatsApp API + Blue Tick', 'AI Calling'

# (header, applies to, group, width, kind, extra)   kind: text | mobile | date | num | int | calc
COLUMNS = [
    ('Record type *', ALL, 'core', 20, 'text'),
    ('Mobile Number *', ALL, 'core', 17, 'mobile'),
    ('Customer (auto)', ALL, 'core', 40, 'calc'),
    # Customer
    ('Customer Name *', {T}, T, 20, 'text'), ('Business Name *', {T}, T, 26, 'text'), ('E-mail', {T}, T, 26, 'text'), ('City', {T}, T, 14, 'text'),
    ('Business Address', {T}, T, 34, 'text'), ('Business Category', {T}, T, 18, 'text'), ('Customer Since', {T}, T, 15, 'date'),
    ('Support Team Member *', {T}, T, 22, 'text'), ('Client Login E-mail', {T}, T, 26, 'text'), ('Client Password', {T}, T, 20, 'password'),
    ('Sold By (Sales)', {T}, T, 18, 'text'),
    # Service
    ('Service *', {S, R, M}, S, 30, 'text'), ('Plan / Package Name', {S}, S, 22, 'text'), ('Price Paid (₹, excl. GST)', {S}, S, 16, 'num'),
    ('Billing Cycle', {S}, S, 14, 'text'), ('Start Date *', {S}, S, 14, 'date'), ('Renewal / Expiry Date', {S}, S, 16, 'date'), ('Days Left', {S}, S, 10, 'calc'),
    ('Status *', {S}, S, 13, 'text'), ('Panel / Platform', {S, A}, S, 28, 'text'), ('Panel Login E-mail / Account ID', {S}, S, 28, 'text'),
    # WhatsApp account
    ('WhatsApp API Number', {W}, W, 17, 'mobile'), ('WABA ID', {W}, W, 19, 'mobile'), ('Display Name', {W}, W, 22, 'text'), ('Blue Tick', {W}, W, 11, 'text'),
    ('Quality Rating', {W}, W, 15, 'text'), ('Messaging Limit', {W}, W, 14, 'text'), ('Message Package', {W}, W, 14, 'text'),
    ('Messages in Package *', {W, R}, W, 16, 'int'), ('Extra Messages Added', {W}, W, 14, 'int'),
    # shared usage
    ('Sent *', {W, C, R}, 'shared', 12, 'int'), ('Delivered', {W, C, R, M}, 'shared', 12, 'int'), ('Read / Answered', {W, C, R}, 'shared', 14, 'int'),
    ('Replied', {W, C}, 'shared', 11, 'int'), ('Failed', {W, C, R}, 'shared', 11, 'int'), ('Messages Left', {W, R}, 'shared', 13, 'calc'),
    ('% Used', {W}, 'shared', 9, 'calc'), ('Campaigns Sent / Run', {W, A, R}, 'shared', 13, 'int'), ('Valid Until', {W, A, R}, 'shared', 14, 'date'),
    ('Data as of *', {W, A, R}, 'shared', 14, 'date'),
    # Campaign
    ('Campaign Name *', {C}, C, 24, 'text'), ('Template Name', {C}, C, 18, 'text'), ('Sent On *', {C}, C, 14, 'date'), ('Audience Type', {C}, C, 16, 'text'),
    ('Audience Size *', {C}, C, 13, 'int'), ('Campaign Status', {C}, C, 14, 'text'),
    # AI Calling
    ('Calling Plan *', {A}, A, 20, 'text'), ('Calling Number(s)', {A}, A, 18, 'mobile'), ('AI Agent Name', {A}, A, 18, 'text'), ('Credits Bought (₹)', {A}, A, 14, 'num'),
    ('Credits Left (₹)', {A}, A, 14, 'num'), ('Minutes Bought', {A}, A, 13, 'int'), ('Minutes Left', {A}, A, 12, 'int'), ('Minutes Used', {A}, A, 12, 'calc'),
    ('Total Calls', {A}, A, 11, 'int'), ('Connected Calls', {A}, A, 12, 'int'), ('Not Answered', {A}, A, 12, 'int'), ('Interested / Leads', {A}, A, 12, 'int'),
    ('Contacts Uploaded', {A}, A, 12, 'int'),
    # RCS / Voice
    ('Sender ID / Brand Name', {R}, R, 22, 'text'), ('Clicks / Key-press Replies', {R}, R, 14, 'int'),
    # Monthly
    ('Month *', {M}, M, 11, 'text'), ('What is delivered (unit) *', {M}, M, 22, 'text'), ('Included in Plan', {M}, M, 12, 'int'), ('Pending', {M}, M, 10, 'calc'),
    ('Result 1 - name', {M}, M, 16, 'text'), ('Result 1 - value', {M}, M, 14, 'text'), ('Result 2 - name', {M}, M, 16, 'text'), ('Result 2 - value', {M}, M, 14, 'text'),
    ('Link (page / profile / website)', {M}, M, 28, 'text'),
    ('Notes', {T, S, M}, 'shared', 30, 'text'),
]

HELPERS = ['Mobile key (helper)', 'Customer key (helper)', 'Customer # (helper)', 'Customer row (helper)', 'Service key (helper)', 'Service row (helper)']

PACKAGES = [('50,000', 50000), ('1 Lakh', 100000), ('2 Lakh', 200000), ('5 Lakh', 500000), ('10 Lakh', 1000000), ('Custom', None)]
PANELS = ['Wabastore (chat.wabastore.shop)', 'Whatsbox(app.whatsbox.shop)', 'Bolify AI', 'Crocodile', 'Meta Business Suite', 'Google', 'Other']

AUTO_FILL = PatternFill('solid', fgColor='E3EFEC')
GREY_OUT = PatternFill(fill_type='solid', start_color='E4E4E4', end_color='E4E4E4')
RED_FILL = PatternFill(fill_type='solid', start_color='F8D0D0', end_color='F8D0D0')
SET_FILL = PatternFill('solid', fgColor='FFF4CC')
EXAMPLE_FILL = PatternFill('solid', fgColor='F2F2F2')
THIN = Side(style='thin', color='D0D7DE')


def build():
    src = openpyxl.load_workbook(SOURCE)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    col = {c[0]: i + 1 for i, c in enumerate(COLUMNS)}
    cl = {name: L(i) for name, i in col.items()}
    n = len(COLUMNS)
    hcol = {h: n + 1 + i for i, h in enumerate(HELPERS)}
    hl = {h: L(i) for h, i in hcol.items()}

    # ---- How to fill / Set once / Support Team --------------------------------------------------------------------------------
    how = wb.create_sheet('How to fill')
    how.column_dimensions['A'].width = 26
    how.column_dimensions['B'].width = 110
    how['A1'] = 'Existing customers - everything on one sheet'
    how['A1'].font = Font(bold=True, size=14)
    lines = [
        ('', 'The whole Support team fills the "Import" tab of this ONE file. The Team Lead / Department Head uploads it once in the CRM (Import existing customers).'),
        ('', 'Every row is one record. The first column, Record type, says which kind. A row uses only the columns of its kind - the other cells turn grey.'),
        ('', ''),
        ('Rules', ''),
        ('1', 'The Mobile Number links every row of one customer (10 digits, no +91, no spaces). Type it on the Customer row; on the other rows pick it from the drop-down.'),
        ('2', 'Add the Customer row first (or anywhere in the file - the order of rows does not matter). The "Customer (auto)" column shows whose row it is (red mobile = not on a Customer row).'),
        ('3', 'Rows 2 to 8 are grey EXAMPLES. Leave or delete them - the import skips them. Start your own rows on row 9.'),
        ('4', 'Columns marked * are required for the kind of row they are used by. Light-green cells fill themselves from other rows - type over one if it is wrong.'),
        ('5', 'Use the drop-downs wherever there is one. Numbers without commas (100000, not 1,00,000). Dates as DD-MM-YYYY. "Data as of" is set once on the "Set once" tab.'),
        ('6', 'NEVER write a panel password. Only the panel login e-mail / account ID. The one password that is allowed is the optional "Client Password" on a Customer row.'),
        ('', ''),
        ('Record types', ''),
        (T, 'One row per customer: name, business, e-mail, Support Team Member, optional client login e-mail and password. Required: Mobile, Customer Name, Business Name, Support Team Member.'),
        (S, 'One row per service a customer bought (3 services = 3 rows). Required: Mobile, Service, Start Date, Status. The renewal date, panel and panel login fill themselves.'),
        (W, 'One row per WhatsApp API customer: package, messages used, quality. Required: Mobile, Messages in Package, Sent, Data as of. Needs the customer to have the WhatsApp API + Blue Tick service (it is added if you forget).'),
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

    once = wb.create_sheet('Set once')
    once.sheet_properties.tabColor = 'F5B400'
    once.column_dimensions['A'].width = 62
    once.column_dimensions['B'].width = 24
    once['A1'] = 'Set once - used on every row'
    once['A1'].font = Font(bold=True, size=14)
    once['A3'] = '"Data as of" - the day you read the numbers from the panels'
    once['B3'].fill, once['B3'].number_format = SET_FILL, 'DD-MM-YYYY'
    dv = DataValidation(type='date', operator='greaterThan', formula1='DATE(2018,1,1)', allow_blank=True, showErrorMessage=True, error='Type the date as DD-MM-YYYY.')
    once.add_data_validation(dv)
    dv.add('B3')
    once['A5'] = 'Light-green cells on the Import tab take this date on their own for WhatsApp account, AI Calling and RCS / Voice rows.'
    once['A5'].font = Font(italic=True)

    team = wb.create_sheet('Support Team')
    srcteam = src['Support Team']
    for row in srcteam.iter_rows():
        for c in row:
            if c.value is not None:
                d = team.cell(c.row, c.column, c.value)
                d.font, d.fill, d.alignment = copy.copy(c.font), copy.copy(c.fill), copy.copy(c.alignment)
    for k, dim in srcteam.column_dimensions.items():
        team.column_dimensions[k].width = dim.width
    team.freeze_panes = 'A2'

    ws = wb.create_sheet('Import')
    ws.sheet_properties.tabColor = '0E5A53'
    lists = wb.create_sheet('Lists')
    guide = wb.create_sheet('Metrics Guide')
    srcg = src['8 Metrics Guide']
    for row in srcg.iter_rows():
        for c in row:
            if c.value is not None:
                d = guide.cell(c.row, c.column, c.value)
                d.font, d.fill, d.alignment = copy.copy(c.font), copy.copy(c.fill), copy.copy(c.alignment)
    for k, dim in srcg.column_dimensions.items():
        guide.column_dimensions[k].width = dim.width
    guide.freeze_panes = 'B2'
    wb._sheets = [wb[n_] for n_ in ['How to fill', 'Set once', 'Import', 'Support Team', 'Metrics Guide', 'Lists']]

    # ---- Lists (hidden) ----------------------------------------------------------------------------------------------------
    for i in range(1, 16):
        lists.cell(i, 1, src['Lists'].cell(i, 1).value)
    for i, (label, num) in enumerate(PACKAGES, start=1):
        lists.cell(i, 3, label)
        lists.cell(i, 4, num)
    for i, p in enumerate(PANELS, start=1):
        lists.cell(i, 5, p)
    lists.cell(1, 6, WA_SERVICE)
    lists.cell(1, 7, PANELS[0])
    lists.cell(2, 6, AI_SERVICE)
    lists.cell(2, 7, 'Bolify AI')
    units = {}
    for r in range(2, srcg.max_row + 1):
        name, usage = srcg.cell(r, 2).value, str(srcg.cell(r, 5).value or '')
        if name and 'Unit:' in usage:
            units[name] = usage.split('Unit:', 1)[1].strip()
    for i, (s_, u) in enumerate(units.items(), start=1):
        lists.cell(i, 8, s_)
        lists.cell(i, 9, u)
    for i, t in enumerate(TYPES, start=1):
        lists.cell(i, 10, t)
    lists.sheet_state = 'hidden'

    # ---- the Import tab: headings -----------------------------------------------------------------------------------------------
    for name, i in col.items():
        c = ws.cell(1, i, name)
        grp = next(g for h, ap, g, *_ in COLUMNS if h == name)
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor=GROUP_COLOR[grp])
        c.alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[L(i)].width = next(w for h, ap, g, w, *_ in COLUMNS if h == name)
    ws.row_dimensions[1].height = 48
    for h, i in hcol.items():
        ws.cell(1, i, h)
        ws.column_dimensions[L(i)].hidden = True
    ws.freeze_panes = 'D2'
    ws['A1'].comment = Comment('Choose what this row is: Customer, Service, WhatsApp account, WhatsApp campaign, AI Calling, RCS / Voice or Monthly deliverable. '
                               'Cells that do not apply to that kind turn grey.', 'CRM')
    ws.auto_filter.ref = f'A1:{L(n)}{LAST}'

    R_ = lambda name: f'${cl[name]}{{r}}'  # a cell of the row, `{r}` filled in below

    # ---- examples (rows 2-8) -----------------------------------------------------------------------------------------------------
    EX = {
        T: {'Mobile Number *': '9820011111', 'Customer Name *': 'Siddhesh Patil', 'Business Name *': 'Galaxy Jewellers', 'E-mail': 'galaxy@example.com', 'City': 'Thane',
            'Business Address': 'Shop 4, Station Road, Thane', 'Business Category': 'Jewellery', 'Customer Since': '15-04-2025', 'Support Team Member *': '(pick from the list)',
            'Client Login E-mail': 'galaxy@example.com', 'Client Password': '(optional)', 'Sold By (Sales)': 'Rahul Mehta', 'Notes': 'EXAMPLE - delete'},
        S: {'Mobile Number *': '9820011111', 'Service *': WA_SERVICE, 'Plan / Package Name': '1 Lakh messages', 'Price Paid (₹, excl. GST)': 15000, 'Billing Cycle': 'Yearly',
            'Start Date *': '15-04-2025', 'Status *': 'Live', 'Notes': 'EXAMPLE - delete'},
        W: {'Mobile Number *': '9820011111', 'WhatsApp API Number': '9820011112', 'WABA ID': '123456789012345', 'Blue Tick': 'Yes', 'Quality Rating': 'High (Green)',
            'Messaging Limit': '1K / day', 'Message Package': '1 Lakh', 'Sent *': 28000, 'Delivered': 25800, 'Read / Answered': 11760, 'Replied': 840, 'Failed': 2200},
        C: {'Mobile Number *': '9820011111', 'Campaign Name *': 'Diwali offer', 'Template Name': 'diwali_offer', 'Sent On *': '20-10-2026', 'Audience Type': 'Segmented',
            'Audience Size *': 4000, 'Sent *': 3500, 'Delivered': 3200, 'Read / Answered': 2500, 'Replied': 100, 'Failed': 300, 'Campaign Status': 'Completed'},
        A: {'Mobile Number *': '9820011111', 'Calling Plan *': 'Credit-based', 'AI Agent Name': 'Riya', 'Credits Bought (₹)': 5000, 'Credits Left (₹)': 3200, 'Minutes Bought': 1000,
            'Minutes Left': 640, 'Total Calls': 410, 'Connected Calls': 260, 'Not Answered': 150, 'Interested / Leads': 31},
        R: {'Mobile Number *': '9820011111', 'Service *': 'RCS Registration + Platform', 'Sender ID / Brand Name': 'Galaxy Jewellers', 'Messages in Package *': 50000, 'Sent *': 12000,
            'Delivered': 11300, 'Read / Answered': 6100, 'Clicks / Key-press Replies': 420, 'Failed': 700},
        M: {'Mobile Number *': '9820011111', 'Service *': 'Social Media Management', 'Month *': 'Oct-2026', 'What is delivered (unit) *': 'Posts', 'Included in Plan': 12,
            'Delivered': 8, 'Result 1 - name': 'Reach', 'Result 1 - value': '12,400', 'Notes': 'EXAMPLE - delete'},
    }
    for i, t in enumerate(TYPES):
        r = 2 + i
        ws.cell(r, 1, t)
        for h, v in EX[t].items():
            ws.cell(r, col[h], v)
        for c in range(1, n + 1):
            ws.cell(r, c).fill = EXAMPLE_FILL
            ws.cell(r, c).font = Font(italic=True, color='555555')
        ws.cell(r, col['Notes'], 'EXAMPLE - delete')

    # ---- formulas on every data row ------------------------------------------------------------------------------------------------
    a, b = cl['Record type *'], cl['Mobile Number *']
    mk, ck, cn_, cr, sk, sr = (hl[h] for h in HELPERS)
    rng = lambda letter: f'${letter}${FIRST}:${letter}${LOOKUP_LAST}'
    ex_rng = rng  # the example rows (2-8) are never looked up

    def f(name, r):
        return f'${cl[name]}{r}'

    for r in range(FIRST, LAST + 1):
        A_ = f'${a}{r}'
        B_ = f'${b}{r}'
        # helpers
        ws.cell(r, hcol['Mobile key (helper)'], f'=IF({B_}="","",TEXT({B_},"0"))')
        ws.cell(r, hcol['Customer key (helper)'], f'=IF(AND({A_}="Customer",{B_}<>""),TEXT({B_},"0"),"")')
        ws.cell(r, hcol['Customer # (helper)'], f'=IF(${ck}{r}<>"",MAX({cn_}$1:{cn_}{r - 1})+1,"")')
        ws.cell(r, hcol['Customer row (helper)'], f'=IF(${mk}{r}="","",IFERROR(MATCH(${mk}{r},{ex_rng(ck)},0),""))')
        ws.cell(r, hcol['Service key (helper)'], f'=IF(AND({A_}="Service",{B_}<>""),TEXT({B_},"0")&"|"&{f("Service *", r)},"")')
        svc_of_row = f'IF({A_}="WhatsApp account","{WA_SERVICE}",IF({A_}="AI Calling","{AI_SERVICE}",IF({A_}="RCS / Voice",{f("Service *", r)},"")))'
        ws.cell(r, hcol['Service row (helper)'], f'=IF(OR(${mk}{r}="",{svc_of_row}=""),"",IFERROR(MATCH(${mk}{r}&"|"&{svc_of_row},{ex_rng(sk)},0),""))')

        crow = f'${cr}{r}'
        cust = lambda name: f'INDEX({ex_rng(cl[name])},{crow})'
        srow = f'${sr}{r}'
        svc = lambda name: f'INDEX({ex_rng(cl[name])},{srow})'

        if True:
            ws.cell(r, col['Customer (auto)']).value = (f'=IF({B_}="","",IF({crow}="","Not on a Customer row",{cust("Business Name *")}&" ("&{cust("Customer Name *")}&")"))')
            # Service rows
            start, cyc, ren = f('Start Date *', r), f('Billing Cycle', r), f('Renewal / Expiry Date', r)
            ws.cell(r, col['Renewal / Expiry Date'], f'=IF(AND({A_}="Service",{start}<>"",{cyc}<>""),IFERROR(EDATE({start},IF({cyc}="Monthly",1,IF({cyc}="Quarterly",3,IF({cyc}="Half-yearly",6,IF({cyc}="Yearly",12,"x"))))),""),"")')
            ws.cell(r, col['Days Left'], f'=IF(AND({A_}="Service",{ren}<>""),{ren}-TODAY(),"")')
            ws.cell(r, col['Panel / Platform'], f'=IF({A_}="Service",IF({f("Service *", r)}="","",IFERROR(VLOOKUP({f("Service *", r)},Lists!$F$1:$G$20,2,FALSE),"")),IF({A_}="AI Calling","Bolify AI",""))')
            ws.cell(r, col['Panel Login E-mail / Account ID'], f'=IF(AND({A_}="Service",{crow}<>""),IFERROR({cust("E-mail")}&"",""),"")')
            # WhatsApp account rows
            ws.cell(r, col['Display Name'], f'=IF(AND({A_}="WhatsApp account",{crow}<>""),IFERROR({cust("Business Name *")}&"",""),"")')
            pkg = f('Message Package', r)
            ws.cell(r, col['Messages in Package *'], f'=IF(AND({A_}="WhatsApp account",{pkg}<>""),IFERROR(IF(VLOOKUP({pkg},Lists!$C$1:$D$6,2,FALSE)=0,"",VLOOKUP({pkg},Lists!$C$1:$D$6,2,FALSE)),""),"")')
            mp, ext, sent = f('Messages in Package *', r), f('Extra Messages Added', r), f('Sent *', r)
            ws.cell(r, col['Messages Left'], f'=IF(AND(OR({A_}="WhatsApp account",{A_}="RCS / Voice"),{mp}<>""),{mp}+IF({A_}="WhatsApp account",N({ext}),0)-N({sent}),"")')
            ws.cell(r, col['% Used'], f'=IF(AND({A_}="WhatsApp account",{mp}<>""),IF({mp}+N({ext})=0,"",N({sent})/({mp}+N({ext}))),"")')
            # shared
            ws.cell(r, col['Valid Until'], f'=IF({srow}="","",IFERROR(IF({svc("Renewal / Expiry Date")}&""="","",{svc("Renewal / Expiry Date")}),""))')
            ws.cell(r, col['Data as of *'], f'=IF(OR({A_}="WhatsApp account",{A_}="AI Calling",{A_}="RCS / Voice"),IF(\'Set once\'!$B$3="","",\'Set once\'!$B$3),"")')
            # AI Calling
            mb, ml = f('Minutes Bought', r), f('Minutes Left', r)
            ws.cell(r, col['Minutes Used'], f'=IF(AND({A_}="AI Calling",{mb}<>""),N({mb})-N({ml}),"")')
            # Monthly
            inc, dlv = f('Included in Plan', r), f('Delivered', r)
            ws.cell(r, col['Pending'], f'=IF(AND({A_}="Monthly deliverable",{inc}<>""),MAX(0,N({inc})-N({dlv})),"")')
            ws.cell(r, col['What is delivered (unit) *'], f'=IF(AND({A_}="Monthly deliverable",{f("Service *", r)}<>""),IFERROR(VLOOKUP({f("Service *", r)},Lists!$H$1:$I$30,2,FALSE),""),"")')
    # light-green on the cells that fill themselves
    autos = ['Customer (auto)', 'Renewal / Expiry Date', 'Days Left', 'Panel / Platform', 'Panel Login E-mail / Account ID', 'Display Name', 'Messages in Package *',
             'Messages Left', '% Used', 'Valid Until', 'Data as of *', 'Minutes Used', 'Pending', 'What is delivered (unit) *']
    auto_fmt = {'Renewal / Expiry Date': 'DD-MM-YYYY', 'Valid Until': 'DD-MM-YYYY', 'Data as of *': 'DD-MM-YYYY', 'Days Left': '0', 'Pending': '0',
                'Messages Left': '#,##0', 'Minutes Used': '#,##0', 'Messages in Package *': '#,##0', '% Used': '0%'}
    for r in range(FIRST, LAST + 1):
        for name in autos:
            cell = ws.cell(r, col[name])
            cell.fill = AUTO_FILL
            if name in auto_fmt:
                cell.number_format = auto_fmt[name]

    # ---- formats, drop-downs, grey-out ----------------------------------------------------------------------------------------------
    fmt = {'mobile': '@', 'password': '@', 'date': 'DD-MM-YYYY', 'num': '#,##0.00', 'int': '#,##0'}
    for name, i in col.items():
        kind = next(k for h, ap, g, w, k, *_ in COLUMNS if h == name)
        if kind in fmt:
            ws.column_dimensions[L(i)].number_format = fmt[kind]
    ws.column_dimensions[L(col['Customer Since'])].number_format = 'DD-MM-YYYY'

    def add_dv(dv, name, soft=False):
        if soft:
            dv.showErrorMessage = False
        ws.add_data_validation(dv)
        dv.add(f'{cl[name]}{FIRST}:{cl[name]}{LAST}')

    add_dv(DataValidation(type='list', formula1='=Lists!$J$1:$J$7', allow_blank=True, showErrorMessage=True, error='Pick the kind of row from the list.'), 'Record type *')
    add_dv(DataValidation(type='list', formula1=f'=Lists!$K$2:$K${CUSTOMERS_LISTED + 1}', allow_blank=True), 'Mobile Number *', soft=True)
    add_dv(DataValidation(type='list', formula1="='Support Team'!$A$2:$A$200", allow_blank=True, showErrorMessage=True, errorStyle='warning',
                          error='This name is not on the Support Team tab.'), 'Support Team Member *')
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
    for name, i in col.items():
        kind = next(k for h, ap, g, w, k, *_ in COLUMNS if h == name)
        if kind == 'date':
            add_dv(DataValidation(type='date', operator='greaterThan', formula1='DATE(2018,1,1)', allow_blank=True, showErrorMessage=True, error='Type the date as DD-MM-YYYY.'), name)
        elif kind in ('int', 'num') and name != 'Messages in Package *':
            add_dv(DataValidation(type='decimal', operator='greaterThanOrEqual', formula1='0', allow_blank=True, showErrorMessage=True, error='Type a number (no commas).'), name)

    # grey out the cells that do not apply to the row's kind
    for name, i in col.items():
        ap = next(ap for h, ap, *_ in COLUMNS if h == name)
        if ap == ALL:
            continue
        others = [t for t in TYPES if t not in ap]
        cond = ','.join(f'${a}{FIRST}="{t}"' for t in others)
        ws.conditional_formatting.add(f'{L(i)}{FIRST}:{L(i)}{LAST}', FormulaRule(formula=[f'OR({cond})'], fill=GREY_OUT))
    # a mobile that is not on a Customer row
    ws.conditional_formatting.add(f'{b}{FIRST}:{b}{LAST}', FormulaRule(
        formula=[f'AND(${a}{FIRST}<>"",${a}{FIRST}<>"Customer",${b}{FIRST}<>"",${cr}{FIRST}="")'], fill=RED_FILL))

    # ---- Lists!K: the mobile numbers of the Customer rows (feeds the drop-down) ------------------------------------------------------------
    lists.cell(1, 11, 'Customers (mobile)')
    for k in range(1, CUSTOMERS_LISTED + 1):
        lists.cell(k + 1, 11, f'=IFERROR(INDEX(Import!{ex_rng(b)},MATCH({k},Import!{ex_rng(cn_)},0)),"")')

    wb.active = wb.sheetnames.index('Import')
    wb.save(OUT)
    print(f'{OUT.name}: {n} columns, rows {FIRST}-{LAST}')


if __name__ == '__main__':
    build()
