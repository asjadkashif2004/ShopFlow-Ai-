# Keys setup

Put every value in `key/All keys.txt` using the same `name : value` style you already used.
The `key/` folder is git-ignored, so nothing in it is ever committed.

## 1. PayPal Sandbox (about 5 minutes, free)

1. Go to <https://developer.paypal.com> and click **Log in to Dashboard**.
   Any PayPal account works. If you don't have one, sign up (free).
2. At the top of the dashboard, make sure **Sandbox** is selected, not **Live**.
3. Open **Apps & Credentials** and click **Create App**.
   - App name: `ShopPilot`
   - Type: **Merchant**
   - Sandbox account: leave the default business account (looks like `sb-xxxx@business.example.com`)
   - Click **Create App**.
4. On the app page, copy the **Client ID**. Under **Secret key 1**, click **Show** and copy the secret.
5. Add both to `key/All keys.txt`:

   ```
   paypal client id : <your client id>
   paypal secret : <your secret>
   ```

6. Find your **test buyer** login. In the left menu open **Testing Tools → Sandbox Accounts**.
   There is a **Personal** account (looks like `sb-xxxx@personal.example.com`).
   Click the **⋯** menu → **View/Edit Account** to see its email and password.
   You use this login in the PayPal popup when you test a checkout. It holds fake money only.
   Keep this one to yourself; you'll click through the test payment.

The client ID is safe to show in the browser. The secret must only ever live on the server.

## 2. Supabase database connection string (about 2 minutes)

The anon and publishable keys are for public browser access. The backend needs the database
connection string so it can create the tables, load the 60 products and store orders safely.

1. Open your project at <https://supabase.com/dashboard>.
2. Click **Connect** at the top of the page.
3. Choose **Session pooler** and copy the connection string. It looks like
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with your database password.
   Forgot it? **Project Settings → Database → Reset database password**.
5. Add it to `key/All keys.txt`:

   ```
   supabase db url : <your connection string>
   ```

Use the **Session pooler** string, not the direct one: the direct connection only works over IPv6
by default, which many hosts (including Hugging Face) can't reach.
