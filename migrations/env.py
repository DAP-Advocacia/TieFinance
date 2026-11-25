from alembic import context
from app.main import Base, engine

target_metadata = Base.metadata


def run_migrations_online():
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
