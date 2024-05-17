import Link from "next/link";

export default function NavItem({ href, children }) {
  return (
    <li>
      <Link href={href}>{children}</Link>
    </li>
  );
}
