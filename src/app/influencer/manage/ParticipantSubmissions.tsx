'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import DatePicker from '@/components/DatePicker';
import {
  REVIEW_CATEGORIES,
  FINAL_CONTENT_TYPES,
  SUBMISSION_STAGE_LABELS,
  SUBMISSION_STATUS_LABELS,
  SUBMISSION_STATUS_COLORS,
  type SubmissionAsset,
  type SubmissionStage,
  type SubmissionReview,
} from '@/lib/types/influencer';
import { formatFileSize } from '@/lib/helpers';
import { colors, radii } from '@/lib/influencer/styles';

interface Props {
  participantId: string;
  participantName: string;
  onRefresh?: () => void;
}

export default function ParticipantSubmissions({ participantId, participantName, onRefresh }: Props) {
  const [assets, setAssets] = useState<SubmissionAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals
  const [revisionModal, setRevisionModal] = useState<{ assetId: string; stage: SubmissionStage } | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [revisionCategory, setRevisionCategory] = useState('');
  const [revisionDetail, setRevisionDetail] = useState('');
  const [saving, setSaving] = useState(false);

  const [proposalModal, setProposalModal] = useState(false);
  const [proposalUrl, setProposalUrl] = useState('');
  const [proposalDate, setProposalDate] = useState('');
  const [proposalMemo, setProposalMemo] = useState('');

  const [uploadModal, setUploadModal] = useState(false);
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadContentType, setUploadContentType] = useState('instagram_reels');
  const [uploadDate, setUploadDate] = useState('');

  const [roughCutModal, setRoughCutModal] = useState(false);
  const [roughCutFile, setRoughCutFile] = useState<File | null>(null);
  const [roughCutDate, setRoughCutDate] = useState('');
  const [roughCutMemo, setRoughCutMemo] = useState('');
  const [roughCutUploading, setRoughCutUploading] = useState(false);
  const [roughCutProgress, setRoughCutProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAssets = useCallback(async () => {
    try {
      const res = await fetch(`/api/influencer/submissions?participant_id=${participantId}`);
      const data = await res.json();
      setAssets(data.assets || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [participantId]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  function getStageAssets(stage: SubmissionStage) {
    return assets.filter(a => a.stage === stage).sort((a, b) => b.version - a.version);
  }

  function getLatest(stage: SubmissionStage) {
    const sa = getStageAssets(stage);
    return sa[0] || null;
  }

  function stageStatus(stage: SubmissionStage) {
    const latest = getLatest(stage);
    if (!latest) return 'not_received';
    return latest.status;
  }

  /* ── Actions ── */

  async function approve(assetId: string) {
    const res = await fetch('/api/influencer/submissions/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId, action: 'approved' }),
    });
    if (res.ok) { fetchAssets(); onRefresh?.(); }
  }

  async function confirmRevision(assetId: string) {
    const res = await fetch('/api/influencer/submissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: assetId, action: 'confirm_revision' }),
    });
    if (res.ok) { fetchAssets(); onRefresh?.(); }
  }

  async function submitRevision() {
    if (!revisionModal) return;
    const reason = revisionModal.stage === 'rough_cut'
      ? (revisionCategory === '기타' ? revisionDetail.trim() : revisionCategory)
      : revisionReason.trim();
    if (!reason) { setError('요청 사유를 입력해주세요'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/influencer/submissions/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: revisionModal.assetId, action: 'revision_requested', reason }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || '저장 실패'); return; }
      setRevisionModal(null); fetchAssets(); onRefresh?.();
    } finally { setSaving(false); }
  }

  async function submitProposal() {
    if (!proposalUrl.trim()) { setError('링크를 입력해주세요'); return; }
    try { new URL(proposalUrl.trim()); } catch { setError('올바른 URL을 입력해주세요'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/influencer/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, stage: 'proposal', external_url: proposalUrl.trim(), received_at: proposalDate ? new Date(proposalDate + 'T00:00:00').toISOString() : undefined, memo: proposalMemo.trim() || undefined }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || '저장 실패'); return; }
      setProposalModal(false); fetchAssets(); onRefresh?.();
    } finally { setSaving(false); }
  }

  async function submitUpload() {
    if (!uploadUrl.trim()) { setError('링크를 입력해주세요'); return; }
    try { new URL(uploadUrl.trim()); } catch { setError('올바른 URL을 입력해주세요'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/influencer/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, stage: 'final_upload', external_url: uploadUrl.trim(), content_type: uploadContentType, received_at: uploadDate ? new Date(uploadDate + 'T00:00:00').toISOString() : undefined }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || '저장 실패'); return; }
      setUploadModal(false); fetchAssets(); onRefresh?.();
    } finally { setSaving(false); }
  }

  async function submitRoughCut() {
    if (!roughCutFile) return;
    const ext = roughCutFile.name.split('.').pop()?.toLowerCase();
    if (ext !== 'mov' && ext !== 'mp4') { setError('MOV 또는 MP4 파일만 허용됩니다'); return; }
    if (roughCutFile.size > 500 * 1024 * 1024) { setError('500MB를 초과합니다. 링크로 공유해주세요'); return; }
    setRoughCutUploading(true); setError(''); setRoughCutProgress(0);
    try {
      const versions = getStageAssets('rough_cut');
      const nextV = (versions[0]?.version || 0) + 1;
      const urlRes = await fetch('/api/influencer/submissions/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, version: nextV, filename: roughCutFile.name }),
      });
      if (!urlRes.ok) { setError('업로드 URL 생성 실패'); return; }
      const { signedUrl, path } = await urlRes.json();

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => { if (e.lengthComputable) setRoughCutProgress(Math.round((e.loaded / e.total) * 100)); });
        xhr.addEventListener('load', () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('업로드 실패')));
        xhr.addEventListener('error', () => reject(new Error('네트워크 오류')));
        xhr.open('PUT', signedUrl);
        xhr.setRequestHeader('Content-Type', roughCutFile.type || 'application/octet-stream');
        xhr.send(roughCutFile);
      });

      const assetRes = await fetch('/api/influencer/submissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participant_id: participantId, stage: 'rough_cut', file_path: path, original_filename: roughCutFile.name, mime_type: roughCutFile.type, file_size: roughCutFile.size, received_at: roughCutDate ? new Date(roughCutDate + 'T00:00:00').toISOString() : undefined, memo: roughCutMemo.trim() || undefined }),
      });
      if (!assetRes.ok) { setError('등록 실패'); return; }
      setRoughCutModal(false); setRoughCutFile(null); fetchAssets(); onRefresh?.();
    } catch (e) { setError((e as Error).message); } finally { setRoughCutUploading(false); }
  }

  async function openFile(filePath: string) {
    const res = await fetch(`/api/influencer/submissions/signed-url?path=${encodeURIComponent(filePath)}`);
    if (res.ok) { const { url } = await res.json(); window.open(url, '_blank'); }
  }

  /* ── Styles ── */

  const btnSmall: React.CSSProperties = { padding: '3px 10px', fontSize: 12, borderRadius: radii.chip, border: `1px solid ${colors.border}`, background: colors.surface, cursor: 'pointer' };
  const btnPrimary: React.CSSProperties = { ...btnSmall, background: colors.accentDark, color: '#fff', border: 'none' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 14, borderRadius: radii.button, border: `1px solid ${colors.border}`, background: colors.surface, boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, marginBottom: 6, display: 'block' };

  if (loading) return <p style={{ fontSize: 12, color: colors.textMuted }}>로딩 중...</p>;

  const stages: SubmissionStage[] = ['proposal', 'rough_cut', 'final_upload'];

  return (
    <div style={{ marginBottom: 16, fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 12, color: colors.textSecondary }}>제출 자료</div>

      {stages.map(stage => {
        const stAssets = getStageAssets(stage);
        const latest = stAssets[0] || null;
        const st = stageStatus(stage);
        const statusColor = SUBMISSION_STATUS_COLORS[st] || '#8A9199';

        return (
          <div key={stage} style={{ marginBottom: 16, paddingLeft: 8 }}>
            {/* Stage header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontWeight: 500 }}>{SUBMISSION_STAGE_LABELS[stage]}</span>
              <span style={{ fontSize: 12, color: statusColor, fontWeight: 500 }}>
                {st === 'approved' && '✓ '}{st === 'revision_requested' && '⚠ '}
                {SUBMISSION_STATUS_LABELS[st]}
                {st === 'approved' && latest?.reviews?.[0]?.created_at && ` ${fmtDate(latest.reviews[0].created_at)}`}
              </span>
            </div>

            {/* Content */}
            {st === 'not_received' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textDisabled }}>
                <span>—</span>
                {stage === 'proposal' && (
                  <button style={btnSmall} onClick={() => { setProposalModal(true); setProposalUrl(''); setProposalDate(today); setProposalMemo(''); setError(''); }}>링크 등록</button>
                )}
                {stage === 'rough_cut' && (
                  <button style={btnSmall} onClick={() => { setRoughCutModal(true); setRoughCutFile(null); setRoughCutDate(today); setRoughCutMemo(''); setError(''); }}>업로드</button>
                )}
                {stage === 'final_upload' && (
                  <button style={btnSmall} onClick={() => { setUploadModal(true); setUploadUrl(''); setUploadDate(today); setUploadContentType('instagram_reels'); setError(''); }}>링크 등록</button>
                )}
              </div>
            ) : stage === 'proposal' ? (
              /* Proposal: single record with link + review history */
              <div>
                {latest?.external_url && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <a href={latest.external_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', fontSize: 12, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>
                      🔗 {new URL(latest.external_url).hostname}...
                    </a>
                    <button style={btnSmall} onClick={() => window.open(latest.external_url!, '_blank')}>열기</button>
                    <button style={btnSmall} onClick={() => { setProposalModal(true); setProposalUrl(latest.external_url || ''); setProposalDate(today); setProposalMemo(''); setError(''); }}>수정</button>
                  </div>
                )}
                {latest?.received_at && <div style={{ fontSize: 11, color: colors.textMuted }}>수령 {fmtDate(latest.received_at)}</div>}

                {/* Inline actions */}
                {st === 'received' && latest && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button style={btnPrimary} onClick={() => approve(latest.id)}>확인 완료</button>
                    <button style={btnSmall} onClick={() => { setRevisionModal({ assetId: latest.id, stage: 'proposal' }); setRevisionReason(''); setError(''); }}>수정 요청</button>
                  </div>
                )}
                {st === 'revision_requested' && latest && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button style={btnSmall} onClick={() => confirmRevision(latest.id)}>수정본 확인</button>
                  </div>
                )}

                {/* Review history */}
                {latest?.reviews && latest.reviews.length > 0 && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 12, color: colors.textMuted, cursor: 'pointer' }}>이력</summary>
                    <div style={{ marginTop: 4, paddingLeft: 8, borderLeft: `2px solid ${colors.border}` }}>
                      {latest.reviews.map((r: SubmissionReview) => (
                        <div key={r.id} style={{ fontSize: 11, marginBottom: 4 }}>
                          <span style={{ color: colors.textMuted }}>{fmtDate(r.created_at)}</span>
                          {' '}
                          <span style={{ fontWeight: 500 }}>{reviewLabel(r.action)}</span>
                          {r.reason && <span style={{ color: '#666' }}> · {r.reason}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : stage === 'rough_cut' ? (
              /* Rough cut: versioned files with per-version history */
              <div>
                {stAssets.map(asset => (
                  <div key={asset.id} style={{ marginBottom: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 500, fontSize: 12 }}>v{asset.version}</span>
                      {asset.file_path ? (
                        <>
                          <span style={{ fontSize: 12, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{asset.original_filename}</span>
                          {asset.file_size && <span style={{ fontSize: 11, color: colors.textMuted }}>{formatFileSize(asset.file_size)}</span>}
                          <span style={{ fontSize: 11, color: colors.textMuted }}>{fmtDate(asset.received_at)}</span>
                        </>
                      ) : asset.external_url ? (
                        <a href={asset.external_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2563EB', textDecoration: 'none' }}>링크</a>
                      ) : null}
                    </div>

                    {/* Version actions */}
                    {asset.id === latest?.id && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        {asset.file_path && (
                          <>
                            <button style={btnSmall} onClick={() => openFile(asset.file_path!)}>보기</button>
                            <button style={btnSmall} onClick={() => openFile(asset.file_path!)}>다운로드</button>
                          </>
                        )}
                        {asset.status === 'received' && (
                          <>
                            <button style={btnPrimary} onClick={() => approve(asset.id)}>확인 완료</button>
                            <button style={btnSmall} onClick={() => { setRevisionModal({ assetId: asset.id, stage: 'rough_cut' }); setRevisionCategory(''); setRevisionDetail(''); setError(''); }}>수정 요청</button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Status for non-latest / revision requested */}
                    {asset.status === 'revision_requested' && (
                      <div style={{ fontSize: 11, color: SUBMISSION_STATUS_COLORS.revision_requested, marginTop: 2 }}>
                        ⚠ 수정 요청 {asset.reviews?.[0]?.created_at && fmtDate(asset.reviews[0].created_at)}
                        {asset.reviews?.[0]?.reason && ` · ${asset.reviews[0].reason}`}
                      </div>
                    )}

                    {/* Per-version review history */}
                    {asset.reviews && asset.reviews.length > 0 && asset.id === latest?.id && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ fontSize: 11, color: colors.textMuted, cursor: 'pointer' }}>이력</summary>
                        <div style={{ marginTop: 2, paddingLeft: 8, borderLeft: `2px solid ${colors.border}` }}>
                          {asset.reviews.map((r: SubmissionReview) => (
                            <div key={r.id} style={{ fontSize: 11, marginBottom: 2 }}>
                              <span style={{ color: colors.textMuted }}>{fmtDate(r.created_at)}</span>{' '}
                              <span style={{ fontWeight: 500 }}>{reviewLabel(r.action)}</span>
                              {r.reason && <span style={{ color: '#666' }}> · {r.reason}</span>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ))}

                <button style={btnSmall} onClick={() => { setRoughCutModal(true); setRoughCutFile(null); setRoughCutDate(today); setRoughCutMemo(''); setError(''); }}>새 버전 업로드</button>
              </div>
            ) : (
              /* Final upload: single record */
              <div>
                {latest?.external_url && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <a href={latest.external_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563EB', fontSize: 12, textDecoration: 'none' }}>
                      🔗 {(() => { try { return new URL(latest.external_url).hostname; } catch { return '링크'; } })()}
                    </a>
                    <button style={btnSmall} onClick={() => window.open(latest.external_url!, '_blank')}>열기</button>
                  </div>
                )}
                {latest?.content_type && (
                  <div style={{ fontSize: 11, color: '#666' }}>{FINAL_CONTENT_TYPES[latest.content_type] || latest.content_type}</div>
                )}
                {latest?.received_at && <div style={{ fontSize: 11, color: colors.textMuted }}>{fmtDate(latest.received_at)}</div>}

                {st === 'received' && latest && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button style={btnPrimary} onClick={() => approve(latest.id)}>확인 완료</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Modals ── */}

      {revisionModal && (
        <Modal onClose={() => !saving && setRevisionModal(null)}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>수정 요청</h3>
          {revisionModal.stage === 'proposal' ? (
            <div>
              <label style={labelStyle}>요청 사유 *</label>
              <textarea style={{ ...inputStyle, minHeight: 72 }} value={revisionReason} onChange={e => setRevisionReason(e.target.value)} placeholder="수정 요청 사유를 입력하세요" />
            </div>
          ) : (
            <div>
              <label style={labelStyle}>요청 사유 *</label>
              {REVIEW_CATEGORIES.map(cat => (
                <label key={cat} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 6 }}>
                  <input type="radio" name="rev_cat_d" checked={revisionCategory === cat} onChange={() => setRevisionCategory(cat)} />
                  {cat}
                </label>
              ))}
              {revisionCategory === '기타' && (
                <textarea style={{ ...inputStyle, minHeight: 56, marginTop: 8 }} value={revisionDetail} onChange={e => setRevisionDetail(e.target.value)} placeholder="상세 내용" />
              )}
            </div>
          )}
          {error && <p style={{ color: colors.coral, fontSize: 13, marginTop: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSmall} onClick={() => setRevisionModal(null)} disabled={saving}>취소</button>
            <button style={btnPrimary} onClick={submitRevision} disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
          </div>
        </Modal>
      )}

      {proposalModal && (
        <Modal onClose={() => !saving && setProposalModal(false)}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>기획안 링크 등록</h3>
          <div style={{ marginBottom: 12 }}><label style={labelStyle}>링크 주소 *</label><input style={inputStyle} value={proposalUrl} onChange={e => setProposalUrl(e.target.value)} placeholder="https://docs.google.com/..." /></div>
          <div style={{ marginBottom: 12 }}><label style={labelStyle}>수령일 *</label><DatePicker value={proposalDate} onChange={setProposalDate} /></div>
          <div style={{ marginBottom: 12 }}><label style={labelStyle}>메모</label><input style={inputStyle} value={proposalMemo} onChange={e => setProposalMemo(e.target.value)} placeholder="선택" /></div>
          {error && <p style={{ color: colors.coral, fontSize: 13, marginTop: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSmall} onClick={() => setProposalModal(false)} disabled={saving}>취소</button>
            <button style={btnPrimary} onClick={submitProposal} disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
          </div>
        </Modal>
      )}

      {roughCutModal && (
        <Modal onClose={() => !roughCutUploading && setRoughCutModal(false)}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>가편집본 업로드</h3>
          <div
            style={{ border: `2px dashed ${colors.border}`, borderRadius: 12, padding: 24, textAlign: 'center', cursor: 'pointer', marginBottom: 12, background: roughCutFile ? '#F0FFF4' : undefined }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setRoughCutFile(f); }}
          >
            <input ref={fileInputRef} type="file" accept=".mov,.mp4" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) setRoughCutFile(f); }} />
            {roughCutFile ? (<><div style={{ fontWeight: 500 }}>{roughCutFile.name}</div><div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{formatFileSize(roughCutFile.size)}</div></>) : (<><div style={{ color: colors.textMuted }}>파일을 끌어다 놓거나 클릭하세요</div><div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>MOV, MP4 · 최대 500MB</div></>)}
          </div>
          {roughCutUploading && <div style={{ marginBottom: 12 }}><div style={{ height: 4, background: '#E5E7EB', borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${roughCutProgress}%`, background: '#2563EB', transition: 'width 0.3s' }} /></div><div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, textAlign: 'center' }}>{roughCutProgress}%</div></div>}
          <div style={{ marginBottom: 12 }}><label style={labelStyle}>수령일 *</label><DatePicker value={roughCutDate} onChange={setRoughCutDate} /></div>
          <div style={{ marginBottom: 12 }}><label style={labelStyle}>메모</label><input style={inputStyle} value={roughCutMemo} onChange={e => setRoughCutMemo(e.target.value)} placeholder="선택" /></div>
          {error && <p style={{ color: colors.coral, fontSize: 13, marginTop: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSmall} onClick={() => setRoughCutModal(false)} disabled={roughCutUploading}>취소</button>
            <button style={btnPrimary} onClick={submitRoughCut} disabled={roughCutUploading || !roughCutFile}>{roughCutUploading ? '업로드 중...' : '저장'}</button>
          </div>
        </Modal>
      )}

      {uploadModal && (
        <Modal onClose={() => !saving && setUploadModal(false)}>
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>최종 업로드 링크 등록</h3>
          <div style={{ marginBottom: 12 }}><label style={labelStyle}>링크 주소 *</label><input style={inputStyle} value={uploadUrl} onChange={e => setUploadUrl(e.target.value)} placeholder="https://instagram.com/reel/..." /></div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>콘텐츠 유형 *</label>
            <select style={inputStyle} value={uploadContentType} onChange={e => setUploadContentType(e.target.value)}>
              {Object.entries(FINAL_CONTENT_TYPES).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
          </div>
          <div style={{ marginBottom: 12 }}><label style={labelStyle}>업로드일 *</label><DatePicker value={uploadDate} onChange={setUploadDate} /></div>
          {error && <p style={{ color: colors.coral, fontSize: 13, marginTop: 8 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={btnSmall} onClick={() => setUploadModal(false)} disabled={saving}>취소</button>
            <button style={btnPrimary} onClick={submitUpload} disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{ position: 'relative', background: colors.surface, borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function reviewLabel(action: string): string {
  switch (action) {
    case 'received': return '수령';
    case 'approved': return '확인 완료';
    case 'revision_requested': return '수정 요청';
    case 'link_updated': return '링크 갱신';
    default: return action;
  }
}
