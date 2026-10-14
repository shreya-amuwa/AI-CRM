# Uploading customer details (Support Team Lead and Team Member)

On the **Add Customer** page, below the form, **Upload customer details** adds many customers at once.

1. Click **Download template** and fill it: one customer per row, up to 500 rows. Columns:
   `Name, Company, Phone, Email, Type, Status, Service, Requirement, Channel, Notes`.
   Only **Name** and a **phone or e-mail** are required. Type: Retail, Wholesale, Corporate or Other. Status: Active, Inactive or
   Prospect. Service: a service name from the list (several separated by `;`). Channel: Phone, WhatsApp, Email, Walk-in, Website or Other.
2. Save it as **CSV** (Excel: File > Save as > CSV; Google Sheets: File > Download > CSV) and choose the file.
3. The sheet is checked before anything is saved: "N ready, M with problems". Each problem names its row and what is wrong.
   Rows with problems are not uploaded; fix them in the sheet and upload again.
4. **Upload N customers**. Each row is saved exactly like the Add Customer form (same checks, assigned to you). A customer whose phone or
   e-mail already exists is skipped and listed with the reason, so nobody is added twice.

The customers are stored in the same customer table as every other customer, so they appear in the customer list and wherever the
customer data is used (for example the client dashboard).
