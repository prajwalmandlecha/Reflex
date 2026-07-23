import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
import datetime
import uuid

# Direct imports from our app models
from app.models import Base, AgentClass, AgentInstance, BankConnection, Policy, AuditLog
from app.database import engine, async_session

async def seed_db():
    print("Creating tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    print("Inserting seed data...")
    async with async_session() as session:
        # Seed Bank Connections (Native MCP)
        banks = [
            BankConnection(id="bank-identity", name="Bank Identity MCP", server_url="http://20.2.83.126:31100/mcp"),
            BankConnection(id="bank-payments", name="Bank Payments MCP", server_url="http://20.2.83.126:31200/mcp"),
            BankConnection(id="bank-financial", name="Bank Financial MCP", server_url="http://20.2.83.126:31300/mcp"),
            BankConnection(id="bank-risk", name="Bank Risk MCP", server_url="http://20.2.83.126:31400/mcp"),
        ]
        session.add_all(banks)

        # Seed Agent Classes
        classes = [
            AgentClass(id="class-support", name="Customer Support Bot", description="Handles basic customer queries and refunds", default_cap=500.0, allowed_tools=["refund_user", "get_balance"]),
            AgentClass(id="class-trading", name="Algo Trader", description="Automated trading agent", default_cap=10000.0, allowed_tools=["buy_stock", "sell_stock"]),
        ]
        session.add_all(classes)

        # Seed Agent Instances
        instances = [
            AgentInstance(id="agent-xyz1", name="Support Alpha", class_id="class-support", status="active", cap_override=500.0, spend_today=120.0, actions_count=45),
            AgentInstance(id="agent-trd9", name="Trader Omega", class_id="class-trading", status="active", cap_override=20000.0, spend_today=15000.0, actions_count=12),
            AgentInstance(id="agent-rsk2", name="Rogue Agent", class_id="class-support", status="revoked", cap_override=500.0, spend_today=500.0, actions_count=99),
        ]
        session.add_all(instances)

        # Seed Policies
        policies = [
            Policy(id=str(uuid.uuid4()), name="Global Refund Limit", description="Max $500 per refund without senior approval", rego_source="package guardian.policy\ndefault allow = false\nallow { input.amount <= 500 }", is_active=True)
        ]
        session.add_all(policies)

        await session.commit()
        print("Database seeded successfully!")

if __name__ == "__main__":
    asyncio.run(seed_db())
