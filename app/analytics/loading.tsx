import PageSkeleton from "@/components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton width="4xl" blocks={[20, 28, 56, 64, 48]} />;
}
