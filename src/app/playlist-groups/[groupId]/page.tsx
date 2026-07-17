import PlaylistGroupDetail from "@/components/PlaylistGroupDetail";
export default function PlaylistGroupPage({ params }: { params: { groupId: string } }) { return <PlaylistGroupDetail groupId={params.groupId}/>; }
