from sqlalchemy import Column, String, Integer, Float, Boolean, JSON, DateTime
from sqlalchemy.orm import declarative_base
import datetime

Base = declarative_base()

class AgentClass(Base):
    __tablename__ = "agent_classes"
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String)
    default_cap = Column(Float, default=0.0)
    allowed_tools = Column(JSON, default=list) # List of tool names

class AgentInstance(Base):
    __tablename__ = "agent_instances"
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    class_id = Column(String, nullable=False)
    status = Column(String, default="active") # active, idle, revoked, killed
    cap_override = Column(Float, nullable=True)
    spend_today = Column(Float, default=0.0)
    actions_count = Column(Integer, default=0)
    last_seen = Column(DateTime, default=datetime.datetime.utcnow)

class Policy(Base):
    __tablename__ = "policies"
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String)
    rego_source = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    agent_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    tool = Column(String, nullable=False)
    decision = Column(String, nullable=False) # allow, deny
    risk_score = Column(Float, default=0.0)
    hash = Column(String, nullable=False)
