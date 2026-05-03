import calendar
import re
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pony.orm import db_session
from pydantic import BaseModel, Field

from src.models import CloserReport, SetterReport, TeamMember

router = APIRouter(prefix="/api/team", tags=["team"], redirect_slashes=False)

DEFAULT_COMMISSION_PCT = 5.0
VALID_ROLES = frozenset({"setter", "closer"})


def require_user_id(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    if x_user_id is None or not x_user_id.strip():
        raise HTTPException(
            status_code=401,
            detail="Se requiere el header X-User-Id con el id del usuario autenticado.",
        )
    return x_user_id.strip()


def _parse_uid(user_id: str) -> int:
    try:
        return int(user_id.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail="X-User-Id debe ser numérico.") from e


def _members_for_user(uid: int) -> list[TeamMember]:
    return [m for m in list(TeamMember.select()) if m.user_id == uid]


def _get_active_member(uid: int, member_id: int, rol: str) -> TeamMember:
    for m in _members_for_user(uid):
        if m.id == member_id and m.activo and m.rol == rol:
            return m
    raise HTTPException(
        status_code=404,
        detail="Miembro no encontrado, inactivo o el rol no coincide con el reporte.",
    )


def _month_range(ym: str) -> tuple[date, date]:
    if not re.match(r"^\d{4}-\d{2}$", ym.strip()):
        raise HTTPException(status_code=400, detail="month debe ser YYYY-MM.")
    y_s, m_s = ym.strip().split("-")
    y, m = int(y_s), int(m_s)
    if m < 1 or m > 12:
        raise HTTPException(status_code=400, detail="Mes inválido en month.")
    start = date(y, m, 1)
    last = calendar.monthrange(y, m)[1]
    end = date(y, m, last)
    return start, end


class CreateTeamMemberBody(BaseModel):
    nombre: str = Field(min_length=1, max_length=500)
    rol: str


class TeamMemberOut(BaseModel):
    id: int
    nombre: str
    rol: str
    activo: bool


class SetterReportBody(BaseModel):
    member_id: int
    fecha: date
    conversaciones: int = 0
    agendas: int = 0
    links_enviados: int = 0
    notas: str | None = None


class CloserReportBody(BaseModel):
    member_id: int
    fecha: date
    llamadas_agendadas: int = 0
    shows: int = 0
    cierres: int = 0
    calificados: int = 0
    descalificados: int = 0
    ingreso: float = 0
    notas: str | None = None


class ReportSavedOut(BaseModel):
    id: int
    updated: bool


class SetterStatsOut(BaseModel):
    member_id: int
    nombre: str
    conversaciones: int
    agendas: int
    links_enviados: int
    comision: float


class CloserStatsOut(BaseModel):
    member_id: int
    nombre: str
    llamadas_agendadas: int
    shows: int
    cierres: int
    calificados: int
    descalificados: int
    ingreso: float
    comision: float


class TeamDashboardOut(BaseModel):
    month: str
    cash_total: float
    comisiones: float
    commission_pct: float
    setters: list[SetterStatsOut]
    closers: list[CloserStatsOut]


@router.get("/members")
def list_members(user_id: str = Depends(require_user_id)) -> dict[str, Any]:
    uid = _parse_uid(user_id)
    with db_session:
        active = [m for m in _members_for_user(uid) if m.activo]
        setters = [
            TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)
            for m in active
            if m.rol == "setter"
        ]
        closers = [
            TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)
            for m in active
            if m.rol == "closer"
        ]
        return {"setters": [s.model_dump() for s in setters], "closers": [c.model_dump() for c in closers]}


@router.post("/members")
def create_member(body: CreateTeamMemberBody, user_id: str = Depends(require_user_id)) -> TeamMemberOut:
    uid = _parse_uid(user_id)
    rol = body.rol.strip().lower()
    if rol not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="rol debe ser 'setter' o 'closer'.")
    nombre = body.nombre.strip()
    if not nombre:
        raise HTTPException(status_code=400, detail="nombre es obligatorio.")
    with db_session:
        m = TeamMember(user_id=uid, nombre=nombre, rol=rol, activo=True)
        m.flush()
        return TeamMemberOut(id=m.id, nombre=m.nombre, rol=m.rol, activo=m.activo)


@router.delete("/members/{member_id}")
def deactivate_member(member_id: int, user_id: str = Depends(require_user_id)) -> dict[str, str]:
    uid = _parse_uid(user_id)
    with db_session:
        found: TeamMember | None = None
        for m in _members_for_user(uid):
            if m.id == member_id:
                found = m
                break
        if found is None:
            raise HTTPException(status_code=404, detail="Miembro no encontrado.")
        found.activo = False
    return {"status": "ok"}


@router.post("/setter-reports")
def save_setter_report(body: SetterReportBody, user_id: str = Depends(require_user_id)) -> ReportSavedOut:
    uid = _parse_uid(user_id)
    with db_session:
        _get_active_member(uid, body.member_id, "setter")
        existing = [
            r
            for r in list(SetterReport.select())
            if r.user_id == uid and r.member_id == body.member_id and r.fecha == body.fecha
        ]
        if existing:
            r = existing[0]
            r.conversaciones = body.conversaciones
            r.agendas = body.agendas
            r.links_enviados = body.links_enviados
            r.notas = body.notas
            return ReportSavedOut(id=r.id, updated=True)
        r = SetterReport(
            user_id=uid,
            member_id=body.member_id,
            fecha=body.fecha,
            conversaciones=body.conversaciones,
            agendas=body.agendas,
            links_enviados=body.links_enviados,
            notas=body.notas,
        )
        r.flush()
        return ReportSavedOut(id=r.id, updated=False)


@router.post("/closer-reports")
def save_closer_report(body: CloserReportBody, user_id: str = Depends(require_user_id)) -> ReportSavedOut:
    uid = _parse_uid(user_id)
    with db_session:
        _get_active_member(uid, body.member_id, "closer")
        existing = [
            r
            for r in list(CloserReport.select())
            if r.user_id == uid and r.member_id == body.member_id and r.fecha == body.fecha
        ]
        if existing:
            r = existing[0]
            r.llamadas_agendadas = body.llamadas_agendadas
            r.shows = body.shows
            r.cierres = body.cierres
            r.calificados = body.calificados
            r.descalificados = body.descalificados
            r.ingreso = body.ingreso
            r.notas = body.notas
            return ReportSavedOut(id=r.id, updated=True)
        r = CloserReport(
            user_id=uid,
            member_id=body.member_id,
            fecha=body.fecha,
            llamadas_agendadas=body.llamadas_agendadas,
            shows=body.shows,
            cierres=body.cierres,
            calificados=body.calificados,
            descalificados=body.descalificados,
            ingreso=body.ingreso,
            notas=body.notas,
        )
        r.flush()
        return ReportSavedOut(id=r.id, updated=False)


@router.get("/dashboard")
def team_dashboard(
    month: str = Query(..., description="YYYY-MM"),
    user_id: str = Depends(require_user_id),
) -> TeamDashboardOut:
    uid = _parse_uid(user_id)
    start, end = _month_range(month)
    ym = month.strip()

    with db_session:
        setter_rows = [
            r
            for r in list(SetterReport.select())
            if r.user_id == uid and start <= r.fecha <= end
        ]
        closer_rows = [
            r
            for r in list(CloserReport.select())
            if r.user_id == uid and start <= r.fecha <= end
        ]

        members_by_id = {m.id: m for m in _members_for_user(uid)}

        setter_totals: dict[int, dict[str, int]] = {}
        for r in setter_rows:
            acc = setter_totals.setdefault(
                r.member_id,
                {"conversaciones": 0, "agendas": 0, "links_enviados": 0},
            )
            acc["conversaciones"] += r.conversaciones
            acc["agendas"] += r.agendas
            acc["links_enviados"] += r.links_enviados

        closer_totals: dict[int, dict[str, float | int]] = {}
        for r in closer_rows:
            acc = closer_totals.setdefault(
                r.member_id,
                {
                    "llamadas_agendadas": 0,
                    "shows": 0,
                    "cierres": 0,
                    "calificados": 0,
                    "descalificados": 0,
                    "ingreso": 0.0,
                },
            )
            acc["llamadas_agendadas"] = int(acc["llamadas_agendadas"]) + r.llamadas_agendadas
            acc["shows"] = int(acc["shows"]) + r.shows
            acc["cierres"] = int(acc["cierres"]) + r.cierres
            acc["calificados"] = int(acc["calificados"]) + r.calificados
            acc["descalificados"] = int(acc["descalificados"]) + r.descalificados
            acc["ingreso"] = float(acc["ingreso"]) + float(r.ingreso)

        active_setters = [m for m in members_by_id.values() if m.activo and m.rol == "setter"]
        active_closers = [m for m in members_by_id.values() if m.activo and m.rol == "closer"]

        setter_out: list[SetterStatsOut] = []
        for m in sorted(active_setters, key=lambda x: x.id):
            t = setter_totals.get(
                m.id,
                {"conversaciones": 0, "agendas": 0, "links_enviados": 0},
            )
            # Sin ingreso en reportes de setter: comisión = 0 (alineado a la UI que usa cash de closer).
            setter_out.append(
                SetterStatsOut(
                    member_id=m.id,
                    nombre=m.nombre,
                    conversaciones=int(t["conversaciones"]),
                    agendas=int(t["agendas"]),
                    links_enviados=int(t["links_enviados"]),
                    comision=0.0,
                )
            )

        closer_out: list[CloserStatsOut] = []
        comisiones = 0.0
        cash_total = 0.0
        for m in sorted(active_closers, key=lambda x: x.id):
            t = closer_totals.get(
                m.id,
                {
                    "llamadas_agendadas": 0,
                    "shows": 0,
                    "cierres": 0,
                    "calificados": 0,
                    "descalificados": 0,
                    "ingreso": 0.0,
                },
            )
            ing = float(t["ingreso"])
            cash_total += ing
            com = ing * (DEFAULT_COMMISSION_PCT / 100.0)
            comisiones += com
            closer_out.append(
                CloserStatsOut(
                    member_id=m.id,
                    nombre=m.nombre,
                    llamadas_agendadas=int(t["llamadas_agendadas"]),
                    shows=int(t["shows"]),
                    cierres=int(t["cierres"]),
                    calificados=int(t["calificados"]),
                    descalificados=int(t["descalificados"]),
                    ingreso=ing,
                    comision=com,
                )
            )

    return TeamDashboardOut(
        month=ym,
        cash_total=cash_total,
        comisiones=comisiones,
        commission_pct=DEFAULT_COMMISSION_PCT,
        setters=setter_out,
        closers=closer_out,
    )
