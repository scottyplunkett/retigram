from .services import orders
from app.services.billing import charge
import os


def create_app():
    return orders.list_orders(), charge


class Settings:
    pass
