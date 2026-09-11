'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import DatePicker from '@/components/DatePicker';
import {
  REVIEW_CATEGORIES,
  FINAL_CONTENT_TYPES,
  SUBMISSION_STAGE_LABELS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_COLORS,
  SUBMISSION_BG_COLORS,
  getSubmissionDisplayStatus,
  type SubmissionAsset,
  type SubmissionStage,
} from '@/lib/types/influencer';
import { formatFileSize } from '@/lib/helpers';
import { colors, radii } from '@/lib/influencer/styles';

/* ── Props ── */

interface Participant {
  id: string;
  name: string;
  display_name: string | null;
  channel: string | null;
  handle: string | null;
}

interface Props {
  campaignId: string;
  participants: Participant[];
  onRefresh?: () => void;
}

/* ── Filter type ── */

type FilterType = 'needs_review' | 'awaiting_revision' | 'all' | 'done';

/* ── Component ── */

export default function SubmissionsTab({ campaignId, participants, onRefresh }: Props) {
  const [assets, setAssets] = useState<SubmissionAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('needs_review');

  // Modals
  const [revisionModal, setRevisionModal] = useState<{ assetId: string; stage: SubmissionStage; participantName: string } | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionCategory, setRevisionCategory] = useState('');
  const [revisionDetail, setRevisionDetail] = useState('');
  const [revisionSaving, setRevisionSaving] = useState(false);

  const [proposalModal, setProposalModal] = useState<{ participantId: string; participantName: string; existing?: SubmissionAsset } | null>(null);
  const [proposalUrl, setProposalUrl] = useState('');
  const [proposalDate, setProposalDate] = useState('');
  const [proposalMemo, setProposalMemo] = useState('');
  const [proposalSaving, setProposalSaving] = useState(false);

  const [uploadModal, setUploadModal] = useState<{ participantId: string; participantName: string } | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadContentType, setUploadContentType] = useState('instagram_reels');
  const [uploadDate, setUploadDate] = useState('');
  const [uploadSaving, setUploadSaving] = useState(false);

  const [roughCutModal, setRoughCutModal] = useState<{ participantId: string; participantName: string } | null>(null);
  const [roughCutFile, setRoughCutFile] = useState<File | null>(null);
  const [roughCutDate, setRoughCutDate] = useState('');
  const [roughCutMemo, setRoughCutMemo] = useState('');
  const [roughCutUploading, setRoughCutUploading] = useState(false);
  const [roughCutProgress, setRoughCutProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [error, setError] = useState('');

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/influencer/submissions?campaign_id=${campaignId}`);
      const data = await res.json();
      setAssets(data.assets || []);
    } catch {
      setError('제출 자료를 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  const today = new Date().toISOString().slice(0, 10);

  /* ── Helpers ── */

  function getParticipantAssets(participantId: string) {
    return assets.filter(a => a.participant_id === participantId);
  }

  function getStageInfo(participantId: string, stage: SubmissionStage) {
    const pAssets = getParticipantAssets(participantId);
    return getSubmissionDisplayStatus(pAssets, stage);
  }

  function getLatestAsset(participantId: string, stage: SubmissionStage): SubmissionAsset | undefined {
    return assets
      .filter(a => a.participant_id === participantId && a.stage === stage)
      .sort((a, b) => b.version - a.version)[0];
  }

  function getAllVersions(participantId: string, stage: SubmissionStage): SubmissionAsset[] {
    return assets
      .filter(a => a.participant_id === participantId && a.stage === stage)
      .sort((a, b) => b.version - a.version);
  }

  /* ── Counts ── */

  const counts = {
    needs_review: 0,
    awaiting_revision: 0,
    all: participants.length,
    done: 0,
  };

  const stages: SubmissionStage[] = ['proposal', 'rough_cut', 'final_upload'];
  const participantStates = participants.map(p => {
    const stageInfos = stages.map(s => getStageInfo(p.id, s));
    const hasNeedsReview = stageInfos.some(si => si.status === 'received');
    const hasRevision = stageInfos.some(si => si.status === 'revision_requested');
    const allDone = stageInfos.every(si => si.status === 'approved');
    return { participant: p, stageInfos, hasNeedsReview, hasRevision, allDone };
  });

  participantStates.forEach(ps => {
    if (ps.hasNeedsReview) counts.needs_review++;
    if (ps.hasRevision) counts.awaiting_revision++;
    if (ps.allDone) counts.done++;
  });

  /* ── Filtered participants ── */

  const filtered = participantStates.filter(ps => {
    if (filter === 'needs_review') return ps.hasNeedsReview;
    if (filter === 'awaiting_revision') return ps.hasRevision;
    if (filter === 'done') return ps.allDone;
    return true;
  }).sort((a, b) => {
    if (filter === 'awaiting_revision') {
      // Sort by longest waiting first
      const getMaxDays = (ps: typeof a) => {
        let max = 0;
        stages.forEach(s => {
          const info = getStageInfo(ps.participant.id, s);
          if (info.daysSinceRevision && info.daysSinceRevision > max) max = info.daysSinceRevision;
        });
        return max;
      };
      return getMaxDays(b) - getMaxDays(a);
    }
    return 0;
  });

  /* ── Actions ── */

  async function handleApprove(assetId: string) {
    const res = await fetch('/api/influencer/submissions/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId, action: 'approved' }),
    });
    if (res.ok) { fetchAssets(); onRefresh?.(); }
  }

  async function handleConfirmRevision(assetId: string) {
    const res = await fetch('/api/influencer/submissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: assetId, action: 'confirm_revision' }),
    });
    if (res.ok) { fetchAssets(); onRefresh?.(); }
  }

  async function handleRevisionSubmit() {
    if (!revisionModal) return;
    const reason = revisionModal.stage === 'rough_cut'
      ? (revisionCategory === '기타' ? revisionDetail.trim() : revisionCategory)
      : revisionReason.trim();
    if (!reason) { setError('요청 사유를 입력해주세요'); return; }

    setRevisionSaving(true);
    setError('');
    try {
      const res = await fetch('/api/influencer/submissions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: revisionModal.assetId,
          action: 'revision_requested',
          reason,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || '저장 실패'); return; }
      setRevisionModal(null);
      setRevisionReason('');
      setRevisionCategory('');
      setRevisionDetail('');
      fetchAssets();
      onRefresh?.();
    } finally {
      setRevisionSaving(false);
    }
  }

  async function handleProposalSubmit() {
    if (!proposalModal) return;
    if (!proposalUrl.trim()) { setError('링크를 입력해주세요'); return; }
    try { new URL(proposalUrl.trim()); } catch { setError('올바른 URL을 입력해주세요'); return; }

    setProposalSaving(true);
    setError('');
    try {
      const res = await fetch('/api/influencer/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: proposalModal.participantId,
          stage: 'proposal',
          external_url: proposalUrl.trim(),
          received_at: proposalDate ? new Date(proposalDate + 'T00:00:00').toISOString() : undefined,
          memo: proposalMemo.trim() || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || '저장 실패'); return; }
      setProposalModal(null);
      setProposalUrl('');
      setProposalDate('');
      setProposalMemo('');
      fetchAssets();
      onRefresh?.();
    } finally {
      setProposalSaving(false);
    }
  }

  async function handleFinalUploadSubmit() {
    if (!uploadModal) return;
    if (!uploadUrl.trim()) { setError('링크를 입력해주세요'); return; }
    try { new URL(uploadUrl.trim()); } catch { setError('올바른 URL을 입력해주세요'); return; }

    setUploadSaving(true);
    setError('');
    try {
      const res = await fetch('/api/influencer/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: uploadModal.participantId,
          stage: 'final_upload',
          external_url: uploadUrl.trim(),
          content_type: uploadContentType,
          received_at: uploadDate ? new Date(uploadDate + 'T00:00:00').toISOString() : undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || '저장 실패'); return; }
      setUploadModal(null);
      setUploadUrl('');
      setUploadContentType('instagram_reels');
      setUploadDate('');
      fetchAssets();
      onRefresh?.();
    } finally {
      setUploadSaving(false);
    }
  }

  async function handleRoughCutSubmit() {
    if (!roughCutModal || !roughCutFile) return;

    const ext = roughCutFile.name.split('.').pop()?.toLowerCase();
    if (ext !== 'mov' && ext !== 'mp4') { setError('MOV 또는 MP4 파일만 업로드할 수 있습니다'); return; }
    if (roughCutFile.size > 500 * 1024 * 1024) { setError('500MB를 초과합니다. 링크로 공유해주세요'); return; }

    setRoughCutUploading(true);
    setError('');
    setRoughCutProgress(0);

    try {
      // 1. Get next version
      const existingVersions = getAllVersions(roughCutModal.participantId, 'rough_cut');
      const nextVersion = (existingVersions[0]?.version || 0) + 1;

      // 2. Get signed upload URL
      const urlRes = await fetch('/api/influencer/submissions/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: roughCutModal.participantId,
          version: nextVersion,
          filename: roughCutFile.name,
        }),
      });
      if (!urlRes.ok) { const d = await urlRes.json(); setError(d.error || '업로드 URL 생성 실패'); return; }
      const { signedUrl, path } = await urlRes.json();

      // 3. Upload file directly to Supabase Storage
      abortRef.current = new AbortController();
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setRoughCutProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('업로드 실패: ' + xhr.status));
        });
        xhr.addEventListener('error', () => reject(new Error('네트워크 오류')));
        xhr.addEventListener('abort', () => reject(new Error('취소됨')));
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', roughCutFile.type || 'application/octet-stream');
        xhr.send(roughCutFile);
      });

      // 4. Register submission asset
      const assetRes = await fetch('/api/influencer/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participant_id: roughCutModal.participantId,
          stage: 'rough_cut',
          file_path: path,
          original_filename: roughCutFile.name,
          mime_type: roughCutFile.type,
          file_size: roughCutFile.size,
          received_at: roughCutDate ? new Date(roughCutDate + 'T00:00:00').toISOString() : undefined,
          memo: roughCutMemo.trim() || undefined,
        }),
      });
      if (!assetRes.ok) { const d = await assetRes.json(); setError(d.error || '등록 실패'); return; }

      setRoughCutModal(null);
      setRoughCutFile(null);
      setRoughCutDate('');
      setRoughCutMemo('');
      setRoughCutProgress(0);
      fetchAssets();
      onRefresh?.();
    } catch (e) {
      if ((e as Error).message !== '취소됨') setError((e as Error).message);
    } finally {
      setRoughCutUploading(false);
      abortRef.current = null;
    }
  }

  async function openSignedUrl(filePath: string) {
    const res = await fetch(`/api/influencer/submissions/signed-url?path=${encodeURIComponent(filePath)}`);
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, '_blank');
    }
  }

  /* ── Styles ── */

  const filterBtn = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: 13,
    borderRadius: radii.chip,
    border: `1px solid ${colors.border}`,
    background: active ? colors.accentDark : colors.surface,
    color: active ? '#fff' : colors.textPrimary,
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
  });

  const cellBase: React.CSSProperties = { padding: '10px 8px', verticalAlign: 'top', fontSize: 13 };
  const btnSmall: React.CSSProperties = { padding: '4px 10px', fontSize: 12, borderRadius: radii.chip, border: `1px solid ${colors.border}`, background: colors.surface, cursor: 'pointer' };
  const btnPrimary: React.CSSProperties = { ...btnSmall, background: colors.accentDark, color: '#fff', border: 'none' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 14, borderRadius: radii.button, border: `1px solid ${colors.border}`, background: colors.surface, boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, marginBottom: 6, display: 'block' };

  if (loading) return <p style={{ padding: 20, color: colors.textMuted, fontSize: 13 }}>불러오는 중...</p>;

  /* ── Summary bar ── */

  const summaryItems = stages.map(s => {
    const done = participants.filter(p => getStageInfo(p.id, s).status === 'approved').length;
    return `${SUBMISSION_STAGE_LABELS[s]} ${done}/${participants.length}`;
  });

  /* ── Render cell ── */

  function renderCell(participantId: string, stage: SubmissionStage, participantName: string) {
    const info = getStageInfo(participantId, stage);
    const latest = getLatestAsset(participantId, stage);
    const isOverdue = info.status === 'revision_requested' && (info.daysSinceRevision || 0) >= 3;
    const bg = info.status === 'received' ? SUBMISSION_BG_COLORS.received
      : isOverdue ? SUBMISSION_BG_COLORS.revision_overdue
      : undefined;
    const statusColor = isOverdue ? SUBMISSION_STATUS_COLORS.revision_overdue : SUBMISSION_STATUS_COLORS[info.status] || '#8A9199';

    return (
      <td
        key={stage}
        style={{ ...cellBase, background: bg, position: 'relative' }}
        className="submission-cell"
      >
        {/* Row 1: Asset link/file */}
        {info.status === 'not_received' ? (
          <span style={{ color: colors.textDisabled, fontSize: 12 }}>—</span>
        ) : (
          <>
            <div style={{ marginBottom: 2 }}>
              {stage === 'proposal' && latest?.external_url && (
                <a href={latest.external_url} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#2563EB', fontSize: 12, textDecoration: 'none' }}
                  title={latest.external_url}>
                  🔗 링크
                </a>
              )}
              {stage === 'rough_cut' && latest && (
                <span style={{ fontSize: 12 }}>
                  {latest.file_path ? (
                    <span style={{ cursor: 'pointer', color: '#2563EB' }}
                      onClick={() => openSignedUrl(latest.file_path!)}>
                      🎥 v{latest.version}
                      {latest.file_size ? ` · ${formatFileSize(latest.file_size)}` : ''}
                    </span>
                  ) : latest.external_url ? (
                    <a href={latest.external_url} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#2563EB', textDecoration: 'none' }}>
                      🔗 v{latest.version}
                    </a>
                  ) : (
                    <span>v{latest.version}</span>
                  )}
                </span>
              )}
              {stage === 'final_upload' && latest?.external_url && (
                <a href={latest.external_url} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#2563EB', fontSize: 12, textDecoration: 'none' }}>
                  🔗 링크
                </a>
              )}
            </div>

            {/* Row 2: Status */}
            <div style={{ color: statusColor, fontSize: 12, fontWeight: 500 }}>
              {info.status === 'approved' && '✓ '}
              {info.status === 'revision_requested' && '⚠ '}
              {SUBMISSION_STATUS_LABELS[info.status]}
              {info.status === 'approved' && latest?.reviews?.[0]?.created_at && (
                <span> {formatShortDate(latest.reviews[0].created_at)}</span>
              )}
            </div>

            {/* Row 3: Supplementary info */}
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
              {info.status === 'received' && latest?.received_at && (
                <span>{formatShortDate(latest.received_at)} 수령</span>
              )}
              {info.status === 'revision_requested' && (
                <>
                  <span>요청 {info.daysSinceRevision != null && info.daysSinceRevision > 0 ? `${info.daysSinceRevision}일` : '방금'}</span>
                  {latest?.reviews?.[0]?.reason && (
                    <div style={{ marginTop: 1 }}>{truncate(latest.reviews[0].reason, 20)}</div>
                  )}
                </>
              )}
              {info.status === 'approved' && stage === 'proposal' && latest?.reviews && (
                <span>요청 {latest.reviews.filter(r => r.action === 'revision_requested').length}회</span>
              )}
            </div>

            {/* Hover actions */}
            <div className="submission-actions" style={{ display: 'none', position: 'absolute', top: 4, right: 4, gap: 4 }}>
              {stage === 'proposal' && (
                <>
                  {latest?.external_url && (
                    <button style={btnSmall} onClick={() => window.open(latest.external_url!, '_blank')}>열기</button>
                  )}
                  {info.status === 'received' && (
                    <>
                      <button style={btnPrimary} onClick={() => handleApprove(latest!.id)}>확인 완료</button>
                      <button style={btnSmall} onClick={() => { setRevisionModal({ assetId: latest!.id, stage: 'proposal', participantName }); setRevisionReason(''); setError(''); }}>수정 요청</button>
                    </>
                  )}
                  {info.status === 'revision_requested' && (
                    <button style={btnSmall} onClick={() => handleConfirmRevision(latest!.id)}>수정본 확인</button>
                  )}
                </>
              )}
              {stage === 'rough_cut' && (
                <>
                  {latest?.file_path && (
                    <>
                      <button style={btnSmall} onClick={() => openSignedUrl(latest.file_path!)}>보기</button>
                      <button style={btnSmall} onClick={() => openSignedUrl(latest.file_path!)}>다운로드</button>
                    </>
                  )}
                  {info.status === 'received' && (
                    <>
                      <button style={btnPrimary} onClick={() => handleApprove(latest!.id)}>확인 완료</button>
                      <button style={btnSmall} onClick={() => { setRevisionModal({ assetId: latest!.id, stage: 'rough_cut', participantName }); setRevisionCategory(''); setRevisionDetail(''); setError(''); }}>수정 요청</button>
                    </>
                  )}
                </>
              )}
              {stage === 'final_upload' && (
                <>
                  {latest?.external_url && (
                    <button style={btnSmall} onClick={() => window.open(latest.external_url!, '_blank')}>열기</button>
                  )}
                  {info.status === 'received' && (
                    <button style={btnPrimary} onClick={() => handleApprove(latest!.id)}>확인 완료</button>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* Not received: register buttons */}
        {info.status === 'not_received' && (
          <div className="submission-actions" style={{ display: 'none', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            {stage === 'proposal' && (
              <button style={btnSmall} onClick={() => { setProposalModal({ participantId, participantName }); setProposalUrl(''); setProposalDate(today); setProposalMemo(''); setError(''); }}>링크 등록</button>
            )}
            {stage === 'rough_cut' && (
              <button style={btnSmall} onClick={() => { setRoughCutModal({ participantId, participantName }); setRoughCutFile(null); setRoughCutDate(today); setRoughCutMemo(''); setError(''); }}>업로드</button>
            )}
            {stage === 'final_upload' && (
              <button style={btnSmall} onClick={() => { setUploadModal({ participantId, participantName }); setUploadUrl(''); setUploadDate(today); setUploadContentType('instagram_reels'); setError(''); }}>링크 등록</button>
            )}
          </div>
        )}
      </td>
    );
  }

  return (
    <div>
      {/* Hover styles */}
      <style>{`
        .submission-cell:hover .submission-actions { display: flex !important; }
        .submission-cell { transition: background 0.15s; }
      `}</style>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>제출 자료</span>
        <span style={{ fontSize: 13, color: colors.textMuted }}>{summaryItems.join(' · ')}</span>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button style={filterBtn(filter === 'needs_review')} onClick={() => setFilter('needs_review')}>
          확인 필요 {counts.needs_review > 0 && counts.needs_review}
        </button>
        <button style={filterBtn(filter === 'awaiting_revision')} onClick={() => setFilter('awaiting_revision')}>
          수정본 대기 {counts.awaiting_revision > 0 && counts.awaiting_revision}
        </button>
        <button style={filterBtn(filter === 'all')} onClick={() => setFilter('all')}>전체</button>
        <button style={filterBtn(filter === 'done')} onClick={() => setFilter('done')}>
          완료 {counts.done > 0 && counts.done}
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ width: '100%', fontSize: 13, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 140 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>인플루언서</th>
              <th style={{ textAlign: 'left' }}>기획안</th>
              <th style={{ textAlign: 'left' }}>가편집본</th>
              <th style={{ textAlign: 'left' }}>업로드</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: colors.textMuted }}>
                {filter === 'needs_review' ? '확인 필요한 자료가 없습니다' : filter === 'awaiting_revision' ? '수정본 대기 중인 건이 없습니다' : filter === 'done' ? '완료된 참여자가 없습니다' : '참여자가 없습니다'}
              </td></tr>
            ) : (
              filtered.map(ps => {
                const p = ps.participant;
                const name = p.name || p.display_name || '(미입력)';
                return (
                  <tr key={p.id}>
                    <td style={{ ...cellBase, fontWeight: 500 }}>
                      <div>{name}</div>
                      {p.handle && <div style={{ fontSize: 11, color: colors.textMuted }}>@{p.handle}</div>}
                    </td>
                    {renderCell(p.id, 'proposal', name)}
                    {renderCell(p.id, 'rough_cut', name)}
                    {renderCell(p.id, 'final_upload', name)}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Revision Request Modal ── */}
      {revisionModal && (
        <ModalOverlay onClose={() => !revisionSaving && setRevisionModal(null)}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>수정 요청</h3>
          <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>{revisionModal.participantName} · {SUBMISSION_STAGE_LABELS[revisionModal.stage]}</p>

          {revisionModal.stage === 'proposal' ? (
            <div>
              <label style={labelStyle}>요청 사유 *</label>
              <textarea
                style={{ ...inputStyle, minHeight: 72 }}
                value={revisionReason}
                onChange={e => setRevisionReason(e.target.value)}
                placeholder="수정 요청 사유를 입력하세요"
              />
            </div>
          ) : (
            <div>
              <label style={labelStyle}>요청 사유 *</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                {REVIEW_CATEGORIES.map(cat => (
                  <label key={cat} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="radio" name="rev_cat" checked={revisionCategory === cat} onChange={() => setRevisionCategory(cat)} />
                    {cat}
                  </label>
                ))}
              </div>
              {revisionCategory === '기타' && (
                <div style={{ marginTop: 8 }}>
                  <label style={labelStyle}>상세 내용 *</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 56 }}
                    value={revisionDetail}
                    onChange={e => setRevisionDetail(e.target.value)}
                    placeholder="상세 내용을 입력하세요"
                  />
                </div>
              )}
            </div>
          )}

          {error && <p style={{ color: colors.coral, fontSize: 13, marginTop: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSmall} onClick={() => setRevisionModal(null)} disabled={revisionSaving}>취소</button>
            <button style={btnPrimary} onClick={handleRevisionSubmit} disabled={revisionSaving}>
              {revisionSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Proposal Link Modal ── */}
      {proposalModal && (
        <ModalOverlay onClose={() => !proposalSaving && setProposalModal(null)}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>기획안 링크 등록</h3>
          <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>{proposalModal.participantName}</p>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>링크 주소 *</label>
            <input style={inputStyle} value={proposalUrl} onChange={e => setProposalUrl(e.target.value)} placeholder="https://docs.google.com/..." />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>수령일 *</label>
            <DatePicker value={proposalDate} onChange={setProposalDate} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>메모</label>
            <input style={inputStyle} value={proposalMemo} onChange={e => setProposalMemo(e.target.value)} placeholder="선택" />
          </div>

          {error && <p style={{ color: colors.coral, fontSize: 13, marginTop: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSmall} onClick={() => setProposalModal(null)} disabled={proposalSaving}>취소</button>
            <button style={btnPrimary} onClick={handleProposalSubmit} disabled={proposalSaving}>
              {proposalSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Rough Cut Upload Modal ── */}
      {roughCutModal && (
        <ModalOverlay onClose={() => !roughCutUploading && setRoughCutModal(null)}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>가편집본 업로드</h3>
          <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>{roughCutModal.participantName}</p>

          <div
            style={{
              border: `2px dashed ${colors.border}`,
              borderRadius: 12,
              padding: 32,
              textAlign: 'center',
              cursor: 'pointer',
              marginBottom: 12,
              background: roughCutFile ? '#F0FFF4' : undefined,
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files[0];
              if (f) setRoughCutFile(f);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".mov,.mp4"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) setRoughCutFile(f); }}
            />
            {roughCutFile ? (
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{roughCutFile.name}</div>
                <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{formatFileSize(roughCutFile.size)}</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 14, color: colors.textMuted }}>파일을 끌어다 놓거나 클릭하세요</div>
                <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>MOV, MP4 · 최대 500MB</div>
              </div>
            )}
          </div>

          {roughCutUploading && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 4, background: '#E5E7EB', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${roughCutProgress}%`, background: '#2563EB', transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, textAlign: 'center' }}>
                {roughCutProgress}%
                <button style={{ ...btnSmall, marginLeft: 8 }} onClick={() => { abortRef.current?.abort(); }}>취소</button>
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>수령일 *</label>
            <DatePicker value={roughCutDate} onChange={setRoughCutDate} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>메모</label>
            <input style={inputStyle} value={roughCutMemo} onChange={e => setRoughCutMemo(e.target.value)} placeholder="선택" />
          </div>

          {error && <p style={{ color: colors.coral, fontSize: 13, marginTop: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSmall} onClick={() => setRoughCutModal(null)} disabled={roughCutUploading}>취소</button>
            <button style={btnPrimary} onClick={handleRoughCutSubmit} disabled={roughCutUploading || !roughCutFile}>
              {roughCutUploading ? '업로드 중...' : '저장'}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Final Upload Modal ── */}
      {uploadModal && (
        <ModalOverlay onClose={() => !uploadSaving && setUploadModal(null)}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>최종 업로드 링크 등록</h3>
          <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>{uploadModal.participantName}</p>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>링크 주소 *</label>
            <input style={inputStyle} value={uploadUrl} onChange={e => setUploadUrl(e.target.value)} placeholder="https://instagram.com/reel/..." />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>콘텐츠 유형 *</label>
            <select style={inputStyle} value={uploadContentType} onChange={e => setUploadContentType(e.target.value)}>
              {Object.entries(FINAL_CONTENT_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>업로드일 *</label>
            <DatePicker value={uploadDate} onChange={setUploadDate} />
          </div>

          {error && <p style={{ color: colors.coral, fontSize: 13, marginTop: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSmall} onClick={() => setUploadModal(null)} disabled={uploadSaving}>취소</button>
            <button style={btnPrimary} onClick={handleFinalUploadSubmit} disabled={uploadSaving}>
              {uploadSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

/* ── Modal Overlay ── */

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
      <div
        style={{ position: 'relative', background: colors.surface, borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ── Utilities ── */

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
