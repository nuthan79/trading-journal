import "./globals.css";
import "./tables.css";
import Analytics from "@/components/Analytics";

export const metadata = {
  title: "Trading Journal",
  description: "Personal swing trading journal — NSE and BSE",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
